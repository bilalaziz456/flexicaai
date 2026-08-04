# Financial-history archive — plan (lean, admin-run)

> **Status: BUILT (migration `0074`).** Shipped as designed, with two implementation notes
> below. This is the **lean** design — a single
> generic archive table, one reusable import pass, uploaded by the **owner / super admin /
> account manager** at onboarding, read-only for the clinic afterwards. It supersedes the
> earlier five-table per-entity draft (kept in git history) — that was more machine than the
> problem needs. Companion to `docs/import-plan.md` (patients / procedures / clinical notes,
> **built**) and `docs/cash-position-plan.md` (opening cash, deferred). Read those first;
> this reuses their machinery and honours their principles.

---

## 1. The ask, in one line

> "When a clinic changes software, they should still have all their previous records — for
> audit, history, etc."

A clinic leaving its old PMS wants its old **bills, receipts, expenses, and doctor payouts**
visible inside FlexicaAI afterwards, *as they were*, forever. Not to re-run its business through
FlexicaAI's engine — just to **look up the past** and to carry the **current outstanding
balance** into the live system so billing works day one.

---

## 2. Why lean (the design bet)

Three facts about financial history drive every choice below:

1. **It's a one-time onboarding job**, run once per clinic and then rarely touched.
2. **The source data is messy** — old invoices/payments/discounts/write-offs come out
   inconsistent. Five rigid per-entity schemas would give *false precision*: pretending the
   old data is cleaner than it is, at five times the build cost.
3. **The only figure that must be exact is already built** — the current outstanding balance
   lands in `patients.opening_balance` today and is collectible day one. Everything else in
   the archive is *audit lookup*, which needs to be **searchable and to total correctly**,
   not perfectly re-modelled.

So: **one generic archive table + the already-built balance bridge**, ~90% of the value for
a fraction of the schema and code, and a shape that fits messy real data. Precise per-entity
reporting stays *recoverable later* (we keep every original column verbatim) if a clinic
ever truly needs it.

---

## 3. The one non-negotiable principle

**The archive is a frozen, read-only snapshot that never enters a live report.**

FlexicaAI's money is **derived, not stored**: `sales`, `sale_shares`, receivables, the P&L are
all computed on demand from *completed appointments* through the billing engine
(`core/appointments/fee.ts`, `core/sales/report.ts`, `core/finance/receivables.ts`,
`core/finance/pl.ts`). Old transactions never happened *in FlexicaAI* — there are no
appointments behind them, and the fees/discounts/splits were the old system's. If they
leaked into the live ledgers they would double-count revenue, invent doctor shares, and
distort "Revenue Recovered", churn, and every super-admin metric.

Two structural choices enforce this, so exclusion is the **default**, not a rule every future
query must remember:

1. **A separate table** (`imported_transactions`) — no `imported` flag on
   `sales`/`patient_payments`/`invoices`. A report that never joins the archive can never
   show it. Same "facts-as-given" instinct as the built import, where imported dues land as a
   flat `opening_balance` rather than reconstructed chains.
2. **A read-only viewer** — the archive is *the* place old numbers live, walled off from
   `/clinic/sales`, `/clinic/payments`, `/clinic/receivables`, `/clinic/finance`.

The **one** sanctioned bridge archive → live is the collectible remainder → `opening_balance`
(§7), made double-count-proof.

**Read-only = no in-place row editing.** You don't hand-edit an archived row (that would let
someone quietly rewrite history — the opposite of an audit archive). You **correct by undoing
the batch and re-importing** the fixed sheet — the same `undoBatch` machinery the built import
already uses. Each batch records who imported what, when.

---

## 4. Who runs it (changed): admin-side upload, clinic-side view

**Upload is an onboarding job owned by the company, not the clinic.** It is sensitive,
one-time, and must reconcile — that belongs with the **owner / super admin / account
manager**, not a clinic receptionist.

- **Entry point:** a **"Financial history"** card/tab on the super-admin **clinic detail**
  page (`/admin/clinics/[id]`). The operator opens the clinic, uploads its history there.
  Opening the clinic *is* the clinic selector.
- **Scope (reuse the established rule):** owner + super admin see/upload for **all** clinics;
  an **account manager** only for clinics where `clinics.assigned_to = them` — the exact
  scoping already applied across the super-admin panel (`docs/super-admin-plan.md`).
- **ACL:** a new admin capability slug **`import_financial`** in `users.permissions`
  (admin `resource:action` catalog); the `owner` (NULL super-admin perms) always has it. This
  is distinct from the clinic-side `import:create` (patients/procedures), which stays
  clinic-self-service.
- **Clinic-side:** the clinic gets a **read-only** History viewer (§8) so they *have* their
  records — but no upload button. (Gated by their finance/sales feature + report `:view`
  permission.)
- Every action `logActivity`-audited with the actor snapshot, like the built import.

---

## 5. Schema — one table

```
imported_transactions
  id                uuid pk
  clinic_id         → clinics (cascade)                 -- every read byClinic
  type              text    -- 'invoice' | 'payment' | 'refund' | 'expense' | 'doctor_payout'
                            --   (+ optional 'doctor_earning', §7.2). Free text, not an enum,
                            --   so a new kind needs no migration.
  txn_date          date    -- the historical date (parseImportDate; no time → no TZ drift)
  amount            int     -- PKR snapshot, as given. Sign by `type` in totals (see below)
  -- who it concerns (snapshot name ALWAYS set; id only when matched) --
  patient_id        → patients (set null)               -- invoices/payments; null if unmatched
  patient_name      text
  external_patient_ref text                              -- their old patient no. (match + display)
  doctor_id         → users (set null)                  -- payouts/earnings; null if unmatched
  doctor_name       text
  -- descriptive --
  description       text                                 -- free text (line summary, category, memo)
  reference         text                                 -- their old invoice/receipt/voucher no.
  method            text                                 -- cash/bank/cheque/card/other (payments)
  raw               jsonb                                -- the ENTIRE original row, verbatim
  -- housekeeping --
  import_batch_id   → import_batches (undo group)
  <softDeleteColumns()>                                  -- so undo + super-admin purge work
  created_at / updated_at
```

- **`raw` jsonb keeps every column we didn't model**, so nothing is lost and a future
  specialised report is recoverable without a re-import.
- **Amounts are int PKR snapshots** — "facts as given"; `parseAmount` strips `Rs`/commas; a
  decimal rounds with a warning.
- **Sign convention (resolved §10.1):** amounts are ALWAYS stored positive; `type` carries the
  direction. Money in = `payment`; money out to a patient = `refund` (a first-class type — a
  negative amount in a payments sheet is auto-classified as a `refund` row with a warning, so
  no `direction` column is needed). Expenses & payouts are money out. Invoices are *billed*
  (not cash) and total separately.
- **Snapshot names** (`patient_name`/`doctor_name`) always set, so a row survives the person
  being renamed/trashed — same instinct as `sales.doctor_name`, `activity_logs.actor_name`.

**Indexes:** `clinic_id`; (`clinic_id`,`type`,`txn_date`) for the viewer's per-type date
scans; `patient_id`; `doctor_id`; `import_batch_id`; GIN pg_trgm on `patient_name` +
`doctor_name` and a b-tree on `reference` for search.

**Migration:** one additive migration creating the table + indexes, and adding
`imported_transactions` to `batches.ts#TABLE` so `undoBatch` covers it. **No live-table
change** (§7.2a resolved — no `users` column).

### What is **not** a table (derived, on purpose)
- **Sales / revenue** = Σ(`type='invoice'`) by day/doctor/period — the invoices *are* the
  historical revenue record. No separate sales table.
- **Receivables** = per patient, Σinvoice − Σpayment. Reported in the viewer; its collectible
  net also seeds `opening_balance` (§7).
- **Doctor outstanding** = per doctor, Σearning − Σpayout. Reported in the viewer;
  optionally seeds a doctor opening balance (§7.2).

---

## 6. The import flow (reuse the built machinery)

The archive is "just more import passes." We reuse `core/admin/import/` wholesale — new
**destination**, not a new framework. One pass per transaction **type** (a clinic exports
separate reports anyway: an invoices sheet, a payments sheet, …). The operator picks the type,
which selects the column catalog; all types commit into the **one** table with `type` stamped.

| Concern | Existing mechanism (reused) | Archive adds |
|---|---|---|
| File parse | `parse.ts#parseImportFile` (CSV+xlsx), `pick()` | — |
| Column mapping | `fields.ts` alias auto-detect + `resolveMapping`/`applyMapping` | per-type field catalogs → generic slots |
| Per-row validate | pure `validateRow` → `RowResult<T>` | per-type validators |
| Dry-run preview | `analyze` + `summarize` → `ImportPreview` | + a **per-type totals footer** |
| Commit | one `db.transaction`, `import_batch_id`, chunked insert (500/batch) | writes `imported_transactions`, `type` stamped, `raw` = the source row |
| Undo / audit | `import_batches` + `undoBatch` soft-deletes the group; `listBatches` | add the one table to `TABLE` |
| Helpers | `normalizePhone`, `parseImportDate`, `parseAmount` | — |

New home: `core/admin/archive/import.ts` (admin-scoped — takes an explicit `clinicId`, unlike
the clinic-context importer). `ArchiveTxnType` union + per-type `FIELDS`-style catalogs.

**The operator sees the same wizard as the built import:**
1. **Open the clinic** (`/admin/clinics/[id]`) → Financial history → pick a type → **upload**.
2. **Map columns** (auto-detected, overridable) → re-preview.
3. **Review** the dry-run: N ready / duplicates / errored / warnings + issue list, **and a
   totals footer** — "these 214 invoices sum to Rs 3,120,000." Matching that number against
   the old system is the clinic's confidence check (§ real-world reconciliation).
4. **Commit** → batch insert. 5. **Undo** the batch if wrong; fix the sheet; re-import.

**Per-type specifics**
- **Invoices** — map patient (ref/phone/name), date, amount (net; if gross+discount given,
  net = gross − discount), reference (old inv no), doctor (optional). Match patient by
  `external_ref` → `phone` → exact `full_name` (the visits-import matcher order); no match →
  archive **unlinked** with a warning (never auto-create patients from a money sheet).
- **Payments** — patient, date, amount, method, reference (old receipt no), optional invoice
  ref (kept as `reference`, not a hard FK). Import invoices **before** payments.
- **Expenses** — category (→ `description`), vendor, date, amount, method, reference. No
  matching. Lowest-risk type → build first.
- **Doctor payouts** — doctor (match by name against clinic `users`, exact then trimmed-ci;
  ambiguous → error; no match → snapshot name, warning), date, amount, method, reference.

**Order dependency:** patients → invoices → payments → doctor payouts. The card suggests the
order and the preview warns on dangling references.

**Duplicate detection:** invoices by (`reference`, patient); payments by (`reference`,
patient); expenses have no natural key → warn (not skip) on (date, amount, vendor) so a real
double cash expense isn't dropped, but a re-uploaded file is flagged.

---

## 7. The one bridge to live data: opening balances (double-count-proof)

### 7.1 Patient dues (collectible) — reconcile with the built flat balance
**Resolved (§10.2): the derive-from-history toggle defaults OFF.** Today
`patients.opening_balance` is set **directly** by the patient import (a flat "old dues"
column), collectible via an `opening` `patient_payment`, and already feeds `receivables.ts`
and `billing/account.ts`. The archive gives a *more precise* way to the same number: per
patient, `max(0, Σ invoice net − Σ payments)`.

To avoid double-counting the dues (once flat, once derived):

- They're **alternative paths**, surfaced as an explicit toggle on the payments commit step:
  **"Set each patient's outstanding balance from this history?"**
  - **Off (default):** archive is pure history; dues stay from the patient sheet's flat
    `opening_balance` (unchanged behaviour). Safest if dues were already imported.
  - **On:** after committing invoices+payments, **set** (never add) each affected patient's
    `opening_balance` = the derived figure, with a confirming diff in the preview ("12
    patients' balances will change: …").
- Always **set**, never add → idempotent; flat and derived paths can't stack.
- Existing `opening` payments stay valid — outstanding re-derives net of them
  (`receivables.ts`, `billing/payments.ts#openingOwed`).

### 7.2 Doctor balance (carry-forward) — resolved: archive-only
**Resolved (§10.3): (a) archive-only.** FlexicaAI's doctor balance is amount-based: Earned
(Σ`sale_shares`) − Paid (Σ`doctor_payouts`) (`core/sales/payouts.ts`). A clinic can migrate
owing a doctor money — we **record the history** (`doctor_payout`, and the optional
`doctor_earning` type) and show it in the viewer's doctor-outstanding figure, but do **not**
touch the live payout balance or add any `users` column. The clinic settles the old balance
outside FlexicaAI.
- Future option (only if a clinic asks): seed a live opening via `users.opening_share_balance`
  = Σ earnings − Σ payouts, folded into `getDoctorBalances`. Deferred — it touches the live
  shares report and must be excluded from *period* views (it's an opening, not a dated
  earning), so it isn't worth the risk until there's real demand.

---

## 8. The read-only viewer (clinic-side)

New **History** nav group under `/clinic/history` (gated by finance/sales feature + report
`:view`), separate from Reports, with a persistent **"Historical — imported from previous
software, read-only"** banner so imported figures are never mistaken for live performance:

- `/clinic/history` — landing: grand totals (billed / collected / outstanding / expenses).
- One list per type (or one list with a **type filter**): searchable (old ref / patient name
  / phone / MRN / doctor), date-filterable, per-type totals, read-only row detail, CSV.

Search + CSV reuse the exact proven patterns (`payments-ledger.ts` pg_trgm name/phone + the
TZ-correct MRN reconstruction `to_char(... AT TIME ZONE tz ...)`; `toCsv`/`streamCsvResponse`
via a `?type=history_*` branch, same auth+feature gate). CSV filenames prefixed `history-…`.

The **super admin / AM** can view the same data from the clinic detail page (they uploaded it),
and via impersonation.

---

## 9. Report-exclusion audit (proof the wall holds)

Separate table ⇒ live readers exclude it **by construction** — none join
`imported_transactions`. Confirmed against the money readers and their tables:
`sales/report.ts`→`sales`; `finance/payments-ledger.ts`→`patient_payments`;
`finance/receivables.ts`→`sales`/`patient_payments`+`patients.opening_balance` (the sanctioned
bridge); `finance/pl.ts`, `finance/daybook.ts`, `sales/payouts.ts`, `sales/share-ledger.ts`,
`billing/invoice.ts#getInvoicesList`, and super-admin `admin/pnl.ts`/`metrics.ts`/`health.ts`
— all live tables only.

**Guardrail to add:** a one-line comment on `imported_transactions` in `schema.ts` — "READ-
ONLY archive; never joined by a live report" — plus the same note in `.claude/database.md`,
so a future change doesn't casually `UNION` it in.

---

## 10. Resolved decisions

1. **Refunds** — amounts are always stored **positive**; `refund` is a first-class `type`
   (§5 sign convention). A negative amount in a payments sheet is auto-classified as a
   `refund` row with a warning. No `direction` column, no marker buried in `raw`.
2. **Patient-dues path** — the "derive `opening_balance` from history" toggle defaults
   **OFF** (§7.1). The flat patient-sheet `opening_balance` (already built) stays the primary
   path; deriving from imported invoices−payments is an explicit opt-in on the payments commit
   step, and always **sets** (never adds), so the two paths can't stack or double-count.
3. **Doctor carry-forward** — **archive-only** (§7.2). No `users.opening_share_balance` and no
   change to the live shares report; `doctor_earning` is an optional archive type feeding only
   the viewer's doctor-outstanding figure. Seeding a live opening stays a deferred future
   option.
4. **Invoices** — **total-only first.** One row per invoice with a net total; any per-line
   detail present in the sheet is preserved verbatim in `raw` for a later grouped-line view.
   No per-line modelling in v1.
5. **Clinic view** — the clinic gets a **read-only** History viewer (§8) so it keeps its
   records; **upload stays company-only** (owner / super admin / account manager, §4). Company
   staff view the same data from the clinic detail page + impersonation.

## 11. Things you might be missing (kept from the deep dive)

- **Reconciliation totals footer** — show per-type grand totals in the preview so the clinic
  verifies "old system said Rs 3.12M billed; so does this" *before* commit. Biggest trust win,
  cheap. (This is how real migrations sign off — see §"real-world process".)
- **Doctor pre-migration balance** (§7.2) — a clinic can owe a doctor money at cutover; the
  `doctor_payout` (and optional `doctor_earning`) rows capture it.
- **Unmatched patients/doctors** — a money sheet references people not in FlexicaAI; archive them
  **unlinked** (snapshot name) rather than erroring or auto-creating.
- **Freeze window** — imports happen after a cutover freeze so no transaction is split between
  systems; a process note for the AM, not code.
- **Currency & TZ** — int PKR via `parseAmount`; historical dates are `date` (no time) to dodge
  TZ drift; MRN search reuses the proven `AT TIME ZONE` reconstruction.
- **Original documents (the old Option A)** — a `document_key` on the row could later attach the
  source PDF/export (ties into storage / `docs/cash-position-plan.md`). Not built now; `raw`
  already keeps the structured original.
- **GST / tax** — GCC VAT lines: keep in `raw`/`description` for now; a first-class field later.
- **Idempotency** — undo-then-reimport is the correction path; per-type duplicate keys stop an
  accidental double-commit from doubling history.
- **"Historical" labelling everywhere** — list headers, CSV filenames, the persistent banner.

---

## 12. Suggested build order

1. **Schema + machinery** — migration for `imported_transactions` (+ indexes, `TABLE` entry);
   `core/admin/archive/import.ts` scaffold (`ArchiveTxnType`, per-type `FIELDS`); the admin
   clinic-detail **Financial history** card, gated by `import_financial` + assignment scope.
2. **Expenses** — simplest (no matching); proves upload → preview → commit → undo → viewer end
   to end on a low-risk type.
3. **Invoices + Payments** — patient matching, the totals footer, and the opt-in
   `opening_balance` derivation (§7.1).
4. **Doctor payouts** — name matching + the §7.2 decision.
5. **Clinic History viewer** (§8) — read-only lists + landing + CSV, gated.
6. **Docs** — `PROGRESS.md`, `.claude/database.md` (the table + the read-only note), and this
   doc → "Built".

Each step is independently shippable; a clinic that only wants old bills can stop after step 3.

---

## 13. As-built notes (deviations from the plan)

Two things changed once the code was in front of us; both make the feature *more*
consistent with the existing codebase, not less:

1. **No new `import_financial` ACL slug — reused `import:create`.** The plan (§4/§10) assumed
   the built importer was clinic-self-service, so a separate money-import capability looked
   like real least-privilege. It isn't: `import:create` is already an **admin-side**
   capability that gates importing patients (PII) *and* clinical notes (medical data) for a
   clinic. Financial history is no more sensitive than clinical notes, and a separate slug
   added a per-entity capability branch + preset churn for no real gain. So the four
   financial passes ride the **same** `import:create` gate and the **same** assignment scope
   (owner/super-admin all clinics; account manager only assigned). An owner who wants an AM
   to run imports grants `import:create` exactly as before.
2. **Extended the existing importer rather than a parallel page.** The upload lives in the
   existing `/admin/clinics/[id]/import` wizard as a second entity group ("Financial history
   (read-only archive)") — four passes (`fin_invoice`/`fin_payment`/`fin_expense`/
   `fin_payout`) that all commit to the one `imported_transactions` table. This reuses the
   whole preview/commit/undo/mapping UI; the archive-only bits (the reconciliation **totals
   footer** and the opt-in **opening-balance** toggle, payments pass only) render just for
   the financial entities. The clinic-side **read-only viewer** is the new `/clinic/history`.

Everything else shipped as written: one generic table, `raw` verbatim, refunds as a
first-class type, doctor-carry-forward archive-only, total-only invoices, clinic-visible
viewer, and the double-count-proof opening-balance bridge (verified end-to-end:
5000 billed − 2000 paid + 500 refund → opening balance 3500).
