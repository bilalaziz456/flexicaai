# Finance — Billing, Payments, Expenses & P&L

> Status: **planning**. Builds on the completed doctor revenue-share feature
> (`docs/doctor-shares-plan.md`). Confirmed decisions below; sequence in §8.
> Reuses existing engines wherever possible (sales report range/bucket helpers,
> `SalesChart`/`SalesFilters`, `pdf-lib`, the cron pattern, soft-delete + Trash).

## 1. What it does

Turns Klenic from "record completed visits" into a real **clinic finance** system:
patients can **owe money**, **pay in parts**, and **pay in advance**; the clinic gets
**invoices/receipts**, a **collected-revenue** truth, **expenses**, and a **P&L**.

## 2. The model (confirmed)

- **Revenue = money COLLECTED** from patients. Each completed visit has a **bill**
  (consultation + procedures − discount, via existing `computeBill`) and a
  **collected** amount; the gap is that patient's **outstanding**.
- **Advance payments**: money paid ahead, held as patient **credit**, applied to
  bills later. Unused credit is **refundable** (P&L-neutral until applied).
- **Doctor share = his % of what's COLLECTED** (grows as the patient pays), not of
  what's billed. `computeShare` (pure) is unchanged; only the *trigger* + the base
  amount change (see §7 Phase 2).
- **P&L** = collected revenue − doctor shares (earned, **accrual**) − expenses.
  **Tax/VAT deferred** but the P&L leaves a slot for a tax line (GCC later).
- Two balances tracked separately: patients owe **us** (receivables), we owe
  **doctors** (payables — already built in `core/sales/payouts.ts`).

## 3. Schema (new)

All tenant-scoped (`clinic_id` + `byClinic`), soft-deletable
(`softDeleteColumns()` → registered in the Trash engine), audit-logged.

- **`patient_payments`** — the money in/out ledger. `id`, `clinic_id`, `patient_id`,
  `appointment_id` (nullable — NULL = unallocated **advance**), `kind`
  (`payment` | `advance` | `advance_applied` | `refund`), `amount` int (PKR),
  `method` (cash/bank/cheque/other — same vocab as payouts), `reference`, `note`,
  `occurred_at`, `created_by` + `created_by_name` (snapshot), soft-delete.
  - Collected on appointment X = Σ `amount` where `appointment_id = X` and
    `kind ∈ (payment, advance_applied)`.
  - Patient **credit** = Σ`advance` − Σ`advance_applied` − Σ`refund`.
- **`invoices`** — one per completed appointment (auto or on demand — §5). `id`,
  `clinic_id`, `appointment_id` (**unique**), `patient_id`, `invoice_no`
  (per-clinic sequence), `issued_at`, `issued_by` + `issued_by_name`, `note`,
  soft-delete. Bill amount is derived live from `computeBill` (snapshotable if a
  bill edit after issue must not move the invoice).
- **`expenses`** — `id`, `clinic_id`, `category_id` → expense_categories
  (`set null`), `amount` int, `incurred_on` date, `vendor`, `method`, `reference`,
  `note`, `recurring` bool + `recurrence` (e.g. monthly), `created_by` +
  `created_by_name`, soft-delete.
- **`expense_categories`** — `id`, `clinic_id`, `name`, `is_active`. Seeded with
  sensible defaults (Rent, Salaries, Supplies, Lab, Utilities, Marketing, Other);
  clinic-editable.
- **`appointments.amount_collected`** int default 0 — **denormalized cache** of Σ
  collected for that appointment, updated on every payment (perf-first: the
  appointment-list Payment filter/badge reads this indexed column, not an
  aggregate). Payment status is derived: `collected ≥ bill` → Paid,
  `0 < collected < bill` → Partial, `= 0` → Unpaid.
- **`clinics`** finance settings: `invoice_paper` (`a4` | `a5` | `thermal`, default
  a4 — the default print format), `invoice_prefix` (e.g. "INV-"), and the
  invoice-number counter (per-clinic; `max(invoice_no)+1` in a txn, or a counter
  column). Optional `currency` left as PKR for now.

## 4. Permissions & gating

- **Billing / payments / invoices / receipts / discounts report** ride on the
  existing **`sales`** feature (they need priced bills) — available to reception
  (collecting money is front-desk work). New **`payments`** permission (collect /
  refund) + reuse `sales`/`shares` view perms for the discounts report.
- **Expenses + P&L + the unified Reports hub** ride on a **new `finance` feature**
  (super-admin, added to `core/lib/features.ts`) + a grantable **`finance`**
  permission (clinic-admin default; sensitive owner data).

## 5. Invoices & receipts — printing (thermal / A5 / A4)

One renderer, three paper formats, two output paths:

- **Formats:** **Thermal** (80 mm default, 58 mm option — narrow, compact, no fixed
  height), **A5** (148×210 mm), **A4** (210×297 mm). The clinic's default is
  `clinics.invoice_paper`; overridable at print time.
- **Browser print** (fastest): a print route with `@media print` + `@page { size: … }`
  per format — thermal = `80mm auto`, A5/A4 = the named size. The panel chrome is
  hidden on print (same technique as the share statement). The browser sends it to
  whatever printer is selected (incl. a thermal/receipt printer).
- **PDF** (download / WhatsApp): generated with **`pdf-lib`** (already bundled, used
  by `prescription-pdf.ts`, Turbopack-safe) at the chosen page size — 80 mm×auto,
  A5, or A4. Reused for both the **invoice** (visit bill: line items − discount +
  total) and the **receipt** (a payment/advance with running balance).
- **Delivery:** print, download PDF, or send over WhatsApp (existing send path).
- **Generation:** on-demand from the appointment ("Invoice" / "Receipt" buttons);
  auto-numbering per clinic. (Auto-issue on completion can be a clinic toggle later.)

## 6. Reuse map (so we don't rebuild)

- **Reports** (Discounts, Expenses, P&L, unified) reuse `sales/report.ts`'s
  `resolveSalesRange` + exported bucket/granularity helpers, and
  `SalesChart` / `SalesFilters`.
- **Recurring expenses** reuse the `api/cron/*` + `CRON_SECRET` pattern.
- **Soft-delete + Trash**: new tables use `softDeleteColumns()` and register in the
  Trash restore/purge lists.
- **PDF**: `pdf-lib` (§5). **CSV**: hand-rolled (no new dependency).
- **Audit**: `logActivity` on every payment/expense/invoice.

## 7. Build phases

1. **Patient billing & payments (foundation).** Schema (`patient_payments`,
   `invoices`, `appointments.amount_collected`, clinic invoice settings +
   categories seed). Core `core/billing/*`: record payment / advance / refund,
   apply advance to a bill, patient balance, invoice-number allocation. Capture
   payment at completion (extend `setAppointmentStatus`: prompt full/partial/none →
   write a `patient_payments` row + bump `amount_collected`). **Invoice + receipt**
   rendering in thermal/A5/A4 (browser print + `pdf-lib`). Per-patient financial
   tab on patient detail. DB-tested.
2. **Collected-basis rewiring.** Move Sales + doctor-share recognition from
   "billed at completion" → "as collected." `sales/ledger.ts` + `share-ledger.ts`
   trigger on a payment (and on completion for the collected-so-far), scaling the
   share by `collected ÷ bill`; `computeShare` unchanged. Bill edits after a
   payment adjust the charge without rewriting collected. DB-tested (Σ shares stays
   exact under partial collection; rounding via the existing largest-remainder).
3. **Appointment-list payments.** A **separate Payment filter** (Paid / Partial /
   Unpaid) beside Status, a per-row **badge** with amount left, and a
   **Collect-payment** action (incl. applying an advance). Reads
   `amount_collected`. The Completed + Unpaid combo = the receivables view.
4. **Discounts report** (`/clinic/discounts`). Every discount: patient, appointment,
   amount (Rs/%), borne-by, affected doctor, approval + approver, date. Pure read
   (appointments + approvals + patients); reuse the report filters.
5. **Expenses module** (`/clinic/expenses`). `expenses` + `expense_categories` CRUD,
   recurring via cron, `finance` feature + permission, soft-delete → Trash,
   audit-logged.
6. **P&L report** (`/clinic/pl`). Collected revenue − doctor shares − expenses = net
   profit, by period / category / doctor, with a revenue-vs-expenses-vs-profit
   chart. Tax slot left unused.
7. **Nav refactor.** PanelShell → parent tabs with `>` expandable subtabs:
   **Finance ›** (Sales · Discounts · Revenue shares · Payouts · Expenses · P&L) ·
   **Clinical ›** · **People ›** · **System ›**; top-level Dashboard · Appointments ·
   WhatsApp · Approvals. Mobile drawer too; auto-expand the active group; remember
   expanded state.
8. **Unified reports + export.** `/clinic/reports` hub tying Sales, Discounts,
   Shares, Expenses, P&L with shared filters + **PDF (`pdf-lib`) / CSV** export +
   month-over-month. Owner **dashboard KPIs** (feature-gated, parallel queries):
   Collected · Outstanding · Payable to doctors · Net profit.

## 8. Sequence & rationale

**1 → 8 in order.** Billing (1) redefines "revenue = collected," so everything reads
from it; the collected-basis rewire (2) and payment UI (3) come straight after;
discounts (4) is a low-risk read; expenses (5) → P&L (6) build the owner picture; the
nav refactor (7) lands once Finance is full; unified reporting + export (8) is the
capstone. Each phase is DB-tested (the `server-only`-stub + dotenv-preload tsx
harness) and finishes with `tsc` clean + `e2e` green, mirroring the revenue-share work.

## 9. Not in scope (yet)

Tax/VAT computation (slot left in P&L), multi-currency, insurance/third-party
claims, payroll beyond doctor payouts, accrual on the *patient* side (patient
revenue stays cash/collected), bank reconciliation.
