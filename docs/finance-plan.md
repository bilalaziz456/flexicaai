# Finance — Billing, Payments, Expenses & P&L

> Status: **planning**. Builds on the completed doctor revenue-share feature
> (`docs/doctor-shares-plan.md`). Reuses existing engines wherever possible (sales
> report range/bucket helpers, `SalesChart`/`SalesFilters`/`AppointmentFilters`,
> `searchClinicPatients`, `pdf-lib`, the cron pattern, soft-delete + Trash).

## 1. What it does

Turns Klenic from "record completed visits" into a real **clinic finance** system:
patients can **owe money**, **pay in parts**, and **pay in advance**; the clinic gets
**invoices/receipts** (thermal/A5/A4), a **collected-revenue** truth, **expenses**,
and a **P&L** — each screen with the **filters** its users need and its own **ACL**.

## 2. The model (confirmed)

- **Revenue = money COLLECTED.** Each completed visit has a **bill** (consultation +
  procedures − discount, via existing `computeBill`) and a **collected** amount; the
  gap is that patient's **outstanding**.
- **Advance payments**: paid ahead, held as patient **credit**, applied to bills
  later. Unused credit is **refundable** (P&L-neutral until applied).
- **Doctor share = his % of what's COLLECTED** (grows as the patient pays), not of
  what's billed. `computeShare` (pure) is unchanged; only the *trigger* + base amount.
- **Net profit** = collected revenue − doctor shares (earned, **accrual**) − expenses.
  **Tax/VAT deferred**; P&L leaves a slot.
- Two balances tracked separately: patients owe **us** (receivables); we owe
  **doctors** (payables — already built).

## 3. Schema (new)

Tenant-scoped (`clinic_id` + `byClinic`), soft-deletable (→ Trash), audit-logged.

- **`patient_payments`** — money in/out ledger. `patient_id`, `appointment_id`
  (NULL = unallocated **advance**), `kind` (`payment` | `advance` | `advance_applied`
  | `refund`), `amount`, `method` (cash/bank/cheque/other — same vocab as payouts),
  `reference`, `note`, `reverses_id` (nullable — the entry a refund/void reverses,
  for traceability), `occurred_at`, `created_by(+name)`, soft-delete.
  - Collected on appt X = Σ where `appointment_id=X` and kind ∈ (payment,
    advance_applied). Patient **credit** = Σadvance − Σadvance_applied − Σrefund.
  - Overpayment → the excess becomes an **advance** (credit).
- **`invoices`** — one per completed appointment. `appointment_id` (**unique**),
  `patient_id`, `invoice_no` (per-clinic sequence — allocated in a txn / counter row
  so concurrent receptionists never collide), `issued_at`, `issued_by(+name)`,
  soft-delete. Bill derived from `computeBill` (snapshotable on issue).
- **`expenses`** — `category_id` → expense_categories (`set null`), `amount`,
  `incurred_on` date, `vendor`, `method`, `reference`, `note`, `recurring` bool +
  `recurrence`, `created_by(+name)`, soft-delete.
- **`expense_categories`** — `name`, `is_active`. Seeded: Rent, Salaries, Supplies,
  Lab, Utilities, Marketing, Other. Clinic-editable.
- **`appointments.amount_collected`** int default 0 — **denormalized cache** of Σ
  collected, updated on every payment (the appointment-list Payment filter/badge
  reads this indexed column, not an aggregate). Status: `collected ≥ bill` Paid ·
  `0<collected<bill` Partial · `=0` Unpaid.
- **`clinics`** finance settings: `invoice_paper` (`a4`|`a5`|`thermal`, default a4),
  `invoice_prefix` (e.g. "INV-"), invoice-number counter.

## 4. Access control (ACL) — every module gated

Two gates, as everywhere in Klenic: a **feature** (super-admin, per clinic) + a
per-user **permission** (`resource:action`, clinic-admin grants). New resources go in
`core/auth/permissions.ts`; pages guard with `requireWorkspace(resource, action)` and
actions re-check `can(user, …)`.

| Area | Feature | Permission · actions | Default roles |
|---|---|---|---|
| Payments · invoices · receipts · patient balance/statement | `sales` | **`billing`** — view · create=Collect · edit · delete=Refund/Void | reception + manager: view+create; **refund/void: clinic_admin + manager** |
| Discounts report | `sales` | **`discounts`** — view | clinic_admin, manager |
| Sales report | `sales` | `sales` — view *(existing)* | clinic_admin, manager |
| Revenue shares · payouts | — | `shares` *(existing; doctor self-view)* | doctor (own), clinic_admin, manager |
| Expenses | **`finance`** *(new)* | **`expenses`** — view/create/edit/delete | clinic_admin (grantable to manager) |
| P&L · unified Reports · finance dashboard KPIs | `finance` | **`finance`** — view | clinic_admin |

- **Self-scoping** stays: a doctor sees only their own shares/earnings; patient
  financials are staff-only.
- **Refund/void is stricter than collect** (delete vs create) — front-desk takes
  money, but a manager/admin reverses it.

## 5. Filters — every list & report

Each screen ships the filters its users actually need, from one composable
**FilterBar** reusing existing primitives (`DatePicker`, Base UI `Select`, the
debounced `searchClinicPatients`, and the `resolveSalesRange` period presets).
Standard set = **period preset + custom From/To + Today**; module-specific on top:

| Screen | Filters |
|---|---|
| Appointment list | date range · status · **payment status (Paid/Partial/Unpaid) — new** · doctor · patient search |
| Payments ledger | date range · patient (search) · method · kind (payment/advance/refund) · doctor |
| Invoices | date range · patient · paid/unpaid · doctor |
| Patient statement | the patient (+ optional date range) |
| Discounts report | period/range · doctor · patient · borne-by (clinic/doctor/split) · approval status |
| Expenses | period/range · category · vendor · method · recurring |
| P&L | period/custom range · doctor · expense category · compare-to-previous |
| Sales report | period · doctor · **patient** · **collected-by method** (extend existing) |
| Revenue shares / Payouts | period · doctor · (payouts) method |
| Day book (daily cash) | single day · method |
| Reports hub | global period + entity filters, carried into export |

All filters push query params (server reads them; perf-first, indexed columns), and
every filtered view can **export** exactly what's on screen (PDF/CSV).

## 6. Invoices & receipts — printing (thermal / A5 / A4)

One renderer, three formats, two output paths:
- **Formats:** **Thermal** (80 mm default, 58 mm option), **A5** (148×210), **A4**
  (210×297). Clinic default in `clinics.invoice_paper`; overridable at print time.
- **Browser print:** `@media print` + `@page { size: … }` per format (thermal =
  `80mm auto`); panel chrome hidden (same trick as the share statement). Prints to any
  selected printer, incl. a thermal/receipt printer.
- **PDF:** `pdf-lib` (already bundled, Turbopack-safe) at the chosen page size — used
  for the **invoice** (line items − discount + total) and the **receipt** (a
  payment/advance + running balance).
- **Delivery:** print · download PDF · WhatsApp. On-demand buttons, auto-numbered.

## 7. Reuse map

Reports → `resolveSalesRange` + bucket helpers + `SalesChart`/`SalesFilters`. Filters
→ `AppointmentFilters`/`SalesFilters` primitives + `searchClinicPatients`. Lists →
the shared `Table` + **`Pagination`** components + the **desktop-table / mobile-card
dual render** (see §10). Recurring expenses → `api/cron/*` + `CRON_SECRET`. New tables
→ `softDeleteColumns()` + Trash. PDF → `pdf-lib`; CSV hand-rolled. Audit →
`logActivity`. Every growable ledger (payments, invoices, expenses) is **paginated**.

## 8. Build phases

1. **Patient billing & payments (foundation).** Schema (`patient_payments`,
   `invoices`, `appointments.amount_collected`, clinic invoice settings + category
   seed). Core `core/billing/*`: record payment / advance / refund, **apply advance**
   to a bill, **void/reverse** a payment (like `voidPayout` — decrements
   `amount_collected`), patient balance, **safe invoice-number allocation**. Capture
   payment at completion (extend `setAppointmentStatus`: full/partial/none → payment
   row + bump cache). **Invoice + receipt** in thermal/A5/A4 (browser print +
   `pdf-lib`). **Printable patient statement** (charges + payments + balance). Per-
   patient **financial tab** on patient detail. `billing` ACL. DB-tested.
2. **Collected-basis rewiring. ✅** Sales + doctor-share recognition moved from
   "billed at completion" → "as collected." `recordSaleForAppointment` self-gates on
   completed and scales gross/net by `collected ÷ bill`; `share-ledger` scales each
   doctor's (full `computeShare`) share by the same fraction; both re-run on every
   payment/refund/void (hooked in `core/billing/payments.ts`) as well as completion/
   edit/approval/restore. `backfillClinicSales` is collected-basis too. Refund of a
   collected payment scales revenue + shares back down; an unallocated-advance refund
   is neutral. **The Sales report + doctor earnings now reflect COLLECTED money.**
   Verified against the DB (8/8): unpaid → 0; 50% paid → net 3000 & doctor 450; 100%
   → 6000 & 900; refund → back to 450.
3. **Appointment-list payments. ✅** A separate **Payment filter**
   (Paid/Partial/Unpaid, shown only when the clinic bills) beside Status, and a
   per-row **badge** (Paid / Partial · Rs X left / Unpaid) on both the desktop table
   and mobile cards. The filter is a SQL derivation of the bill (consultation +
   procedures − gated discount) vs `amount_collected`; the Collect-payment action is
   already on the appointment detail (Phase 1b). Completed + Unpaid = the receivables
   view. Verified against the seed (3/3). *(WhatsApp payment reminder = later.)*
4. **Discounts report** (`/clinic/discounts`). ✅ Every discounted visit: patient,
   doctor, amount (Rs, incl. the % note), **borne-by**, **approval status**, date;
   summary of Applied / Pending-approval / Count. `core/sales/discounts-report.ts`
   (pure read; the Rs amount = `computeFee` on the visit subtotal so it matches the
   bill). Filters: period/custom range · doctor · borne-by · status (reuses the sales
   report's `resolveSalesRange` + an exported `FilterSelect`). Dual-render mobile.
   `discounts` permission (feature `sales`); nav under Finance. Verified (8/8).
5. **Expenses** (`/clinic/expenses`). `expenses` + `expense_categories` CRUD,
   recurring via cron, `finance` feature + `expenses` permission, soft-delete → Trash,
   audit-logged. Filters per §5.
6. **P&L** (`/clinic/pl`). Collected revenue − doctor shares − expenses = net profit,
   by period/category/doctor, with a revenue-vs-expenses-vs-profit chart + compare-to-
   previous. Tax slot unused. `finance` ACL.
7. **Nav refactor.** PanelShell → parent tabs with `>` expandable subtabs:
   **Finance ›** (Sales · Discounts · Revenue shares · Payouts · Expenses · P&L) ·
   **Clinical ›** · **People ›** · **System ›**; top-level Dashboard · Appointments ·
   WhatsApp · Approvals. Mobile drawer too; auto-expand the active group; remember
   expanded state.
8. **Unified reports + export + day book.** `/clinic/reports` hub tying Sales,
   Discounts, Shares, Expenses, P&L with shared filters + **PDF (`pdf-lib`) / CSV**
   export + month-over-month. **Day book** (daily cash collected by method — for
   end-of-day reconciliation). Owner **dashboard KPIs** (feature-gated, parallel
   queries): Collected · Outstanding · Payable to doctors · Net profit.

## 9. Sequence & rationale

**1 → 8 in order.** Billing (1) redefines "revenue = collected," so everything reads
from it; the collected-basis rewire (2) and payment UI (3) follow; discounts (4) is a
low-risk read; expenses (5) → P&L (6) build the owner picture; the nav refactor (7)
lands once Finance is full; unified reporting + export + day book (8) is the capstone.
Each phase is DB-tested (the `server-only`-stub + dotenv-preload tsx harness) and
finishes `tsc` clean + `e2e` green, mirroring the revenue-share work.

## 10. Mobile & responsive (every screen — non-negotiable)

The app already has a **gold-standard responsive pattern** (see
`reception/appointments-list.tsx`); every finance screen follows it:

- **Lists = dual render.** A `<Table>` inside `hidden md:block` for desktop **and** a
  stacked **card list** (`md:hidden`, `RowLink as="li"`) for mobile — never a wide
  table that forces the page to scroll sideways. Applies to payments, invoices,
  discounts, expenses, P&L breakdowns, day book.
- **Retrofit:** the tables shipped in the revenue-share work (`/clinic/shares` by-
  doctor + payments, the doctor statement, `/clinic/sales`) are still desktop-only
  `<table>`s — bring them to the dual pattern as a small pre-step so "everything is
  mobile" is actually true.
- **Filter bars** already `flex-wrap`; on mobile a many-filter bar gets tall, so wrap
  it in a collapsible **"Filters"** disclosure (expanded on desktop, collapsed on
  mobile) to keep the screen usable.
- **Summary/KPI cards**: `grid sm:grid-cols-2 lg:grid-cols-4` (stack on mobile).
  **Forms** (collect payment, expense): `grid sm:grid-cols-N` (stack on mobile).
- **Charts** are already width-responsive (`SalesChart` uses `ResizeObserver`).
- **Primary actions** (New expense / Collect / Export): follow the existing pattern —
  a full-width or reachable control on mobile, not a desktop-only button.
- **Invoice / receipt / statement previews** are readable on a phone; the print CSS
  (thermal/A5/A4) is independent of screen size.
- **Nav refactor** (§8 Phase 7): parent/subtabs work in the **mobile drawer** too
  (auto-expand the active group).

## 11. Not in scope (yet)

Tax/VAT computation (slot left in P&L), multi-currency, insurance/third-party claims,
credit notes for post-issue invoice changes, payroll beyond doctor payouts, accrual on
the *patient* side (patient revenue stays cash/collected), bank reconciliation.
