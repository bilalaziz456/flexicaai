# Finance v2 — Credit Notes & Accounting Export

> Status: **PLAN (not built)**. Extends the completed Finance v1
> (`docs/finance-plan.md`). Everything here is **core** under the existing
> `finance` feature flag + ACL — NOT a specialty module (a dentist, dermatologist
> and hair surgeon all issue credit notes and export to their accountant
> identically). Reuses the invoice numbering/print engine, the `patient_payments`
> ledger, the sales/receivables/P&L reads, soft-delete + Trash, and the report
> range/CSV helpers.

## 1. Why (the gaps)

Finance v1 is collected-basis and complete, but two accounting-real gaps remain:

1. **You can't correct an *issued* invoice.** Invoices today derive their amount
   from `computeBill` at render — so an invoice you already printed for Rs X
   silently reprints as Rs Y if a line/discount later changes. That's not
   audit-safe. The accounting-correct fix is: **freeze the invoice at issue** and
   record any later change as a **credit note** that references the original.
   (Patient *refunds* — money back — already exist in `patient_payments`; this is
   about the *document* + the *balance*, not just cash out.)
2. **No accountant-shaped export.** Per-report CSVs exist (payments, expenses,
   receivables, day book), but there's no single **period transaction/journal
   export** an accountant (or QuickBooks/Xero) can import.

**Out of scope (still):** bank-statement reconciliation (matching UI — deferred),
tax/VAT (P&L slot unchanged), multi-currency, insurance/claims, line-level credit
notes (v2.1), QBO/Xero-specific templates (start generic — see §5).

## 2. The model (confirmed)

- **An issued invoice is immutable.** Its total is **snapshotted** at issue. Editing
  the appointment afterward never changes a printed invoice. This also makes the
  invoice a stable base for the credit note.
- **A credit note reduces what the patient owes on a visit** (a contra to the
  invoice). It is a **numbered document** (own per-clinic sequence + prefix, like
  invoices) referencing the original invoice.
- **Money flow after a credit note** (net bill drops by the credit amount):
  - `collected ≤ new bill` → outstanding simply shrinks (nothing else to do).
  - `collected > new bill` → the difference is already paid, so it becomes patient
    **credit** (an `advance` in `patient_payments`) — refundable via the existing
    refund flow. **No new money primitive is invented; credit notes reuse
    `patient_payments`.**
- **P&L / sales:** patient revenue stays **cash/collected** (v1 rule unchanged), so a
  credit note that isn't yet refunded doesn't move collected revenue — it moves
  **receivables** (billed − credited − collected). When a resulting refund is paid,
  that shows as cash out. Credit notes appear as their own **contra line** in reports
  and the export (never by mutating the `sales` row).
- **Receivables** everywhere become: `outstanding = billed − creditNotes − collected`.

## 3. Schema (new / changed)

Tenant-scoped (`clinic_id` + `byClinic`), soft-deletable (→ Trash), audit-logged.

- **`invoices` (change)** — add `amount` int (snapshot of `computeBill` at issue;
  reads/prints use it, never live recompute). Optional `subtotal`/`discount_total`
  snapshots for the printed breakdown. **Migration backfills** existing live invoices
  from the current `computeBill` so nothing regresses.
- **`credit_notes` (new)** — `id`, `clinic_id`, `invoice_id` → invoices (`cascade`),
  `appointment_id` → appointments (`set null`), `patient_id`, `credit_no` (per-clinic
  sequence via a locked counter, like invoices), `amount` int (positive; the credited
  amount), `reason` (free text), `issued_at`, `issued_by(+name)` snapshot, `note`,
  soft-delete columns. Indexes: `(clinic_id,credit_no)` unique, `(invoice_id)`,
  `(clinic_id,issued_at)`, `(patient_id)`, partial trash index.
  - **Guard:** Σ live credit notes for an invoice ≤ the invoice `amount` (can't credit
    more than was billed).
- **`clinics` (change)** — `next_credit_no` int + `credit_prefix` (e.g. "CN-"),
  mirroring the invoice counter/prefix.

## 4. Logic (core)

- **`core/billing/invoice.ts`** — on issue, compute + store the `amount` snapshot
  (inside the same `FOR UPDATE` txn that allocates the number). Reads/print switch to
  the stored amount.
- **`core/billing/credit-note.ts` (new)** — `issueCreditNote(invoiceId, amount,
  reason)` (locks the clinic row, bumps `next_credit_no`, validates the ≤-invoice
  guard, writes the row, recomputes the appointment's collected/credit state, and — if
  now overpaid — records the excess as a patient `advance`), `voidCreditNote(id)`
  (soft-delete + restore the balance), and read helpers. All best-effort around the
  cache recompute (mirrors the payments pattern; never drift).
- **Receivables / bill math** — extend the shared receivable SQL
  (`appointmentBillNetSql` and the receivables report) to subtract live credit notes,
  so the appointment list, receivables report, invoices list, and P&L all agree from
  one source.

## 5. Accounting export (generic CSV v1)

- **`core/finance/accounting-export.ts` (new)** + **`/clinic/reports/accounting`** (or
  a download action on the reports hub) — a **date-range** export producing one
  **transaction/journal CSV** on the cash basis:
  - **Rows** = every money event in the period: patient payments (in), refunds (out),
    expenses (out), doctor payouts (out) — plus **document rows** for invoices issued
    and **credit notes** issued (reference/contra).
  - **Columns**: `date, type, doc_no, party, account/category, method, money_in,
    money_out, reference, note`. Clean account labels so an accountant can map to their
    chart of accounts.
  - Reuses the existing ledger queries; clinic-scoped; gated by `finance` + a reports
    permission; UTF-8 BOM so Excel opens Urdu/Arabic names correctly.
- **Format slot:** the exporter takes a `format` param; **`generic` ships now**,
  `quickbooks`/`xero` templates are a later drop-in (no schema change).
- **Bank reconciliation:** DEFERRED (statement import + matching UI — a separate
  project; most clinics reconcile in their own tool from this export).

## 6. Access control

- Everything gated by the **`finance` feature** (unchanged) ∩ per-user permissions.
- **Issue/void a credit note** → the billing/finance edit permission (reuse
  `billing:edit`, or add a `credit_notes` resource if we want it separately grantable
  — decide at build). Audit-logged (`create`/`delete`, entity `credit_note`).
- **Accounting export** → the reports/finance view permission (same gate as the P&L /
  day book).
- Soft-delete + Trash for credit notes like every other deletable record.

## 7. Build phases

1. **Invoice amount snapshot** (immutability). Add `invoices.amount` (+ optional
   subtotal/discount), populate on issue, backfill live invoices, switch reads/print
   to the snapshot. _Small; also a correctness fix — ship first._
2. **Credit notes.** `credit_notes` table + counter, `core/billing/credit-note.ts`
   (issue/void + overpay→advance), receivable/bill math, print (thermal/A5/A4 marked
   "CREDIT NOTE", referencing the invoice), UI on the invoice/appointment detail, ACL,
   audit, Trash + Restore.
3. **Accounting CSV export.** `core/finance/accounting-export.ts` +
   `/clinic/reports/accounting`, generic transaction/journal CSV over the period,
   including credit notes as a contra line; `format` slot for QBO/Xero later.

**Deferred (v2.1+):** line-level credit notes, QuickBooks/Xero export templates, bank
reconciliation, tax/VAT.

## 8. Definition of done

- An issued invoice never changes amount after issue; edits after issue require a
  credit note. Credit note is numbered, printable, capped at the invoice total,
  soft-deletable, audited.
- Receivables, the appointment list, the invoices list, the P&L and the export all
  reflect credit notes from **one** shared calculation (no drift).
- Overpayment after a credit note becomes refundable patient credit via the existing
  flow (no new money primitive).
- The accounting export downloads a clean period CSV covering payments, refunds,
  expenses, payouts, invoices and credit notes; clinic-scoped; ACL-gated.
- Everything core, `finance`-feature-gated, `clinic_id`-scoped; tsc clean; verified
  end-to-end over HTTP.
