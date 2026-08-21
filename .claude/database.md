# Database schema — FlexicaAI

> **Source of truth is `src/core/db/schema.ts`** (Drizzle). Migrations are
> generated from it (`npm run db:generate`) into `/drizzle`. Never hand-edit the
> database — change the schema file and generate a migration. This document is the
> human-readable reference; if it disagrees with `schema.ts`, `schema.ts` wins.
>
> Imported by root `CLAUDE.md` §5.

---

## 1. Principles (always true)

**Design every table to support multiple specialties from day one.**

- **Core, specialty-agnostic.** Only shared platform tables live in `schema.ts`.
  Core never hardcodes a specialty; the `module` column is a free-text tag (NOT an
  enum) so adding derma/hair needs no schema change.
- **Specialty data goes in related tables, not core.** Dental-specific data (e.g.
  tooth-chart state) belongs in a `dental_records` table linked to `visits`, never
  as columns on core tables. When derma is added, `derma_records` is a new table;
  core tables never change.
- **Multi-tenancy:** every tenant table has `clinic_id`, and **every query filters
  by `clinic_id`** — enforced in the server-side query layer via the `byClinic()`
  helper (`src/core/db/tenant.ts`). The browser never touches the DB; all access is
  through Server Actions / Route Handlers. Native Postgres RLS is a possible future
  defense-in-depth; for now the query layer is the boundary.
- **Timestamps:** all `created_at` / `updated_at` are `timestamptz` defaulting to
  `now()`. All ids are `uuid` default random.
- **Soft delete (NOTHING is hard-deleted).** Every deletable table carries four
  columns (spread from `softDeleteColumns()` in `schema.ts`): `deleted_at`
  timestamptz (NULL = live; the source of truth), `deleted_by` uuid (who trashed
  it; no FK — users are themselves soft-deleted), `delete_group` uuid (one id
  shared by a parent and the children its deletion cascade-hid → Restore reverts
  exactly that batch), `deleted_by_cascade` bool (true = hidden only because a
  parent was trashed; the Trash list shows only the non-cascade rows). Tables with
  soft delete: `clinics`, `users`, `patients`, `appointments`, `visits`, `recalls`,
  `procedures`, `doctor_leaves`, `expenses`, `patient_payments`, `invoices`,
  `clinic_payments`, `company_expenses`, `clinic_invoices` (the last three are
  managed in their own ledgers, not the central Trash UI). The
  central Trash UI (`core/trash`, `/clinic/trash` + `/admin/trash`) currently lists +
  restores `clinics`/`users`/`patients`/`appointments`/`visits`/`recalls`/`procedures`/
  `expenses`/`doctor_leaves` (payments/invoices soft-delete but are managed in their
  own ledgers, not the Trash UI). **Every normal read must filter `deleted_at IS
  NULL`.** A trashed record leaves the clinic-level Trash after
  `clinics.trash_retention_days` (default 30, super-admin-set) but stays in the DB
  and visible to the super admin forever; the ONLY physical delete is a super-admin
  legal purge. `users.username` / `email` uniqueness is PARTIAL (`WHERE deleted_at
  IS NULL`) so a name frees up after a soft delete. Each table has a partial trash
  index on (`clinic_id`,`deleted_at`) `WHERE deleted_at IS NOT NULL`.
  (Migration `0027`.)

---

## 2. Enums

| Enum | Values |
|---|---|
| `user_role` | super_admin, clinic_admin, manager, doctor, receptionist |
| `theme_preference` | system, light, dark |
| `appointment_status` | scheduled, confirmed, completed, cancelled, no_show |
| `visit_status` | draft, approved |
| `recall_status` | pending, scheduled, sent, booked, completed, cancelled |
| `whatsapp_direction` | inbound, outbound |
| `whatsapp_status` | queued, sent, delivered, read, failed, received |

---

## 3. Tables

### `clinics` — tenants
`id`, `name`, `modules_enabled` text[] (e.g. `{dental}`; specialty checkboxes
read/write this), `features_enabled` text[] (super-admin-toggled optional features,
e.g. `{revenue_dashboard}` — see `core/lib/features.ts`), `log_access` text[]
(activity-log action categories the clinic admin may see, e.g. `{login,update}`;
empty = no log access — see `core/audit/access.ts`), `avg_visit_value` int
(PKR, default 3000; drives "Revenue Recovered"), `trash_retention_days` int
(default 30; §1 soft-delete). **Per-clinic WhatsApp sender (Meta Cloud API — see
`docs/whatsapp-cloud-plan.md`):** `whatsapp_phone_number_id` (selects the sending
number; **unique when set** — the inbound routing key), `whatsapp_display_number`
(E.164), `whatsapp_sender_name`, `whatsapp_signature` (clinic-customisable footer
for the template's {{signature}} var). All NULL = not configured → platform sender /
graceful no-send. Timestamps + soft-delete columns.
Indexes: GIN pg_trgm on `name` (fast ILIKE search); partial unique on
`whatsapp_phone_number_id`; partial trash index on `deleted_at`.

### `users` — staff accounts
`id`, `clinic_id` → clinics (**nullable**; NULL for super_admin; `on delete set
null`), `username` (**unique**, lowercased), `email` (**unique when present**),
`password_hash` (bcrypt), `role` (enum), `prefix` (name title — Dr/Mr/Miss…, shown
as "Dr. Bilal Aziz"), `full_name`, `avatar_key` (profile-picture storage key, served
self-only via `GET /api/me/avatar`), `is_active` (default true),
`must_change_password` (default false), `theme` (enum). **Doctor-only fields:**
`availability` jsonb `DayAvailability[]` (per-weekday working windows — a weekday
may appear multiple times for split shifts, e.g. Mon 09:00–12:00 AND 16:00–19:00), 
`flexible_hours` bool (default false; true = bookable any time, hours not enforced —
leave + cap still apply), `daily_appointment_limit` int (0 = unlimited),
`consultation_fee` int (PKR, 0 = not set). **`permissions`** text[] (nullable) —
per-user `resource:action` grant slugs; NULL = fall back to the role's defaults,
a non-null array fully replaces them (see `core/auth/permissions.ts`; two-tier
access = clinic capability ∩ this). Timestamps.
Indexes: unique `username`, unique `email`, `clinic_id`.

### `sessions` — server-side sessions
`id`, `user_id` → users (`on delete cascade`), `token_hash` (**unique**; SHA-256 of
the opaque cookie token), `expires_at`, `created_at`. Validated per request in Node
(not the Edge proxy). Indexes: unique `token_hash`, `user_id`, `expires_at`.

### `patients` — shared across specialties
`id`, `clinic_id` → clinics (`cascade`), `full_name`, `phone` (WhatsApp number,
primary contact), `email`, `date_of_birth`, `gender`, `address`, `notes`,
`reference` (free text — how the patient was referred, e.g. a doctor/patient/ad),
`data_consent` (default false), timestamps. Note: `date_of_birth` is still the
stored source of truth, but the UI enters/shows it as **age** (derived — see
`core/lib/age.ts`), so age never goes stale.
Indexes: `clinic_id`; (`clinic_id`,`phone`); (`clinic_id`,`full_name`); GIN pg_trgm
on `full_name` and `phone`.

### `appointments` — shared
`id`, `clinic_id` → clinics (`cascade`), `patient_id` → patients (`cascade`),
`doctor_id` → users (`set null`), `module` (free-text tag), `scheduled_at`,
`duration_minutes` (default 30), `status` (enum, default scheduled), `reason`,
`discount_type` (free-text, default 'amount'; 'amount' = flat PKR, 'percent' = % of
the doctor's fee), `discount_value` int (default 0; the raw figure — e.g. 500, or 20
for 20%), `discount_borne_by` (free-text, default 'clinic'; 'clinic'|'doctor'|'split'
— who absorbs the discount in the doctor/clinic split), `discount_status` (free-text,
default 'none'; 'none'|'pending'|'approved'|'rejected' — a 'pending'/'rejected'
discount is treated as 0 in the bill/sale/split until approved, derived from
`appointment_discount_approvals`, see `core/appointments/approvals.ts`),
`charge_consultation` bool (default true; **false = procedure-only visit**,
the doctor's consultation fee is not billed — the bill/sale count only procedures),
`source` (free-text, default 'staff'; 'whatsapp' = patient self-booked →
stays a request until staff confirm), `reminder_sent_at` (set once the day-before
reminder is sent; NULL = not reminded), `queue_session` (text, NULL when no doctor;
groups a doctor's appointments for one visiting WINDOW on a day —
`${doctorId}:${YYYY-MM-DD}:w{idx}`, or `:day` for flexible/no-window), `queue_number`
(int, NULL when no doctor; FCFS patient token within that session, assigned at
booking, stable across cancellations), timestamps. The net fee (doctor's
`consultation_fee` − discount) is derived live via `core/appointments/fee.ts`, never
stored, so a fee change flows through. Queue logic: `core/appointments/queue.ts`.
Indexes: `clinic_id`; `patient_id`; (`clinic_id`,`scheduled_at`); `doctor_id`;
(`scheduled_at`,`reminder_sent_at`) for the reminder cron; UNIQUE
(`clinic_id`,`queue_session`,`queue_number`) — token uniqueness + assignment lookup
(NULLs distinct, so un-queued rows never collide).

### `visits` — shared; stores the AI note
`id`, `clinic_id` (`cascade`), `patient_id` (`cascade`), `appointment_id` → appts
(`set null`), `doctor_id` → users (`set null`), `module`, `status` (enum, default
draft — **AI notes are draft until a doctor approves**), `transcript` (raw Whisper),
`note` jsonb (module-shaped, doctor's approved version), `ai_draft` jsonb (frozen
original for the accuracy flywheel), `audio_key` (storage key), `visit_date`,
`approved_at`, `approved_by` → users (`set null`), timestamps.
Indexes: `clinic_id`; `patient_id`; (`clinic_id`,`visit_date`); `appointment_id`.

### `recalls` — recall engine reads/advances these
`id`, `clinic_id` (`cascade`), `patient_id` (`cascade`), `source_visit_id` → visits
(`set null`), `module`, `reason` (e.g. "6-month cleaning"), `due_at`, `status`
(enum, default pending), `sent_at`, timestamps.
Indexes: `clinic_id`; `patient_id`; (`clinic_id`,`due_at`); `status`.

### `whatsapp_messages` — inbound + outbound log
`id`, `clinic_id` → clinics (`cascade`, **nullable**), `patient_id` → patients (`set
null`, **nullable** — an unknown inbound number may be unattributed), `direction`
(enum), `phone`, `status` (enum, default queued), `template_name` (AiSensy
campaign), `body` (preview text), `media_url`, `external_id` (provider id for
receipts), `error`, `payload` jsonb (raw), timestamps. Every send is recorded first
so nothing is lost when the provider is unconfigured; also the source for the
receptionist WhatsApp queue and inbound reschedule.
Indexes: `clinic_id`; `patient_id`; `phone`; (`clinic_id`,`created_at`);
`external_id`.

### `doctor_leaves` — leave / vacation
`id`, `clinic_id` → clinics (`cascade`), `doctor_id` → users (`cascade`),
`start_date` date, `end_date` date (inclusive; single day sets both equal),
`reason`, `created_at`. Set by receptionist/clinic admin; creating a leave cancels
the doctor's appointments in range and blocks new bookings on those days.
Indexes: `clinic_id`; (`doctor_id`,`start_date`,`end_date`) for the booking guard.

### `activity_logs` — audit / activity trail
`id`, `clinic_id` → clinics (`cascade`, **nullable** — NULL for pure super-admin
actions), `actor_user_id` → users (`set null`, **nullable**), `actor_name`
(snapshot, so the row survives the user being renamed/deleted), `actor_role`
(snapshot), `action` (free-text: create/update/delete/login/view/status),
`entity` (patient/appointment/staff/clinic/settings/session/leave), `entity_id`
(uuid, nullable), `summary` (human line), `metadata` jsonb, `created_at`. Records
**all clinic-staff actions + logins + record views**. Access is PERMISSION-based
(not time-based): the super admin grants each clinic a set of visible ACTION
categories via `clinics.log_access` (see `core/audit/access.ts`); the clinic admin
(`/clinic/logs`) sees only those categories for their own clinic, and no log page
at all when `log_access` is empty. The super admin (`/admin/logs`) always sees
everything across clinics. Both pages default to TODAY with date-range + employee
filters (+ clinic filter for the super admin). Written via best-effort
`logActivity`/`logActivityAs` (never throws/blocks); views come from a client
`ViewLogger` (avoids prefetch phantom logs).
Indexes: (`clinic_id`,`created_at`); (`created_at`); `actor_user_id`.

### `procedures` — priced services (Sales feature, phase 1)
`id`, `clinic_id` → clinics (`cascade`), `name`, `price` int (whole PKR),
`module` (free-text specialty tag), `is_active` bool (default true; inactive =
hidden from booking, kept for history), timestamps. CORE + specialty-agnostic —
each clinic manages its own list; the specialty MODULE only supplies suggested
defaults (`ModuleDefinition.procedureTemplates`, imported via
`config/modules.ts#procedureTemplatesFor`). CRUD by clinic admin OR receptionist
(`app/reception/procedure-actions.ts`), audit-logged, gated by the `sales`
feature (`core/lib/features.ts`). Indexes: `clinic_id`; (`clinic_id`,`is_active`).

### `appointment_procedures` — appointment line items (Sales feature, phase 2)
`id`, `clinic_id` → clinics (`cascade`), `appointment_id` → appointments
(`cascade`), `procedure_id` → procedures (`set null`), `name` + `unit_price`
(**snapshots** — catalog edits never rewrite past appointments), `quantity`
(user-set in the booking form, ≥ 1), `discount_type` (free-text, default 'amount')
+ `discount_value` int (default 0) — an **optional per-line discount** applied to
THIS line's gross (`unit_price×quantity`) BEFORE the appointment-level discount —
and `created_at`. The bill is **layered**: each line is discounted first (`lineNet
= gross − line discount`), summed with the consultation fee into a **subtotal**,
then the appointment's own discount applies to that subtotal. ONE formula does this
(ADR-015): `core/appointments/fee.ts#billFromTotals`, with `computeBill` (from lines)
and `computeSaleAmounts` (for the ledger snapshot) as projections of it. To keep the
many callers a single fast aggregate (not N queries), the same formula is expressed in
SQL by `procedures.ts#procedureRowNetSql` (per line) and
`bill-sql.ts#appointmentNetSql` (per appointment) — bound to the TS by
`scripts/test-bill-parity.ts`, which asserts they agree to the rupee, so the two can
no longer drift. Correlated `appointmentProceduresNetSql` / `appointmentProceduresGrossSql` helpers
used by both appointment lists, the WhatsApp confirmation + reschedule quote, the
sales ledger, and the report's per-procedure breakdown. Saved on create/edit via
`saveAppointmentProcedures` (replace-all, `{procedureId, quantity, discountType,
discountValue}[]`, clinic-scoped); `getAppointmentProcedureItems` reads the snapshots
back for the edit-form prefill and the read-only bill. Indexes: `appointment_id`;
`clinic_id`; `procedure_id`.

### `sales` — realised-revenue ledger (Sales feature, phase 3)
`id`, `clinic_id` → clinics (`cascade`), `appointment_id` → appointments
(`cascade`, **UNIQUE** — one sale per appointment), `doctor_id` → users (`set
null`), `doctor_name` (**snapshot**, survives the doctor being renamed/deleted),
`gross_amount` / `discount_amount` / `net_amount` (int PKR, **snapshots** computed
via `computeSaleAmounts` = fee + procedures − discount; `gross` is the TRUE
pre-discount figure, so `gross − discount = net` always holds), `occurred_at`
(= the appointment's `scheduled_at`; drives the report's time buckets),
`created_at`. One row per **completed** appointment, written by
`core/sales/ledger.ts`: `recordSaleForAppointment` (upsert on the completion hook
in `setAppointmentStatus`, and re-snapshot when a completed appointment is edited),
`voidSaleForAppointment` (delete when it leaves "completed"),
`backfillClinicSales` (idempotent; run when the super admin first enables the
`sales` feature, in `admin/actions.ts#updateClinic`). All best-effort — a ledger
hiccup never blocks the status change. The report (`core/sales/report.ts`,
`/clinic/sales`) reads this table: summary, per-doctor + per-procedure breakdown,
and a bucketed net-sales-over-time chart, filterable by period / custom range /
doctor. Gated by the `sales` feature; clinic-scoped. Indexes: UNIQUE
`appointment_id`; (`clinic_id`,`occurred_at`) for the range scan; `doctor_id`.

### `sale_shares` — per-doctor share ledger (revenue-share, phase 4)
`id`, `clinic_id` → clinics (`cascade`), `appointment_id` → appointments
(`cascade`), `doctor_id` → users (`set null`), `doctor_name` (**snapshot**),
`share_amount` int (PKR), `occurred_at` (= the appointment's `scheduled_at`),
`created_at`. One row per DOCTOR who earned a positive
share on a **completed** appointment — the CLINIC's cut is derived (sale net − Σ
these rows), so there is no clinic row. Snapshotted at completion via
`core/appointments/shares.ts#computeShare` on the **approval-gated** net, so later
rate/discount edits never rewrite history. Written by `core/sales/share-ledger.ts`,
folded into `recordSaleForAppointment` / `voidSaleForAppointment` /
`backfillClinicSales` so it stays in lockstep with the `sales` ledger (recording
REPLACES all rows for the appointment; a multi-doctor visit yields several).
**Inert** when no doctor has a share % (no rows). Earnings and payments are an
AMOUNT-based running balance (Phase 7 — no per-share paid flag). Indexes:
(`appointment_id`); (`clinic_id`,`occurred_at`); (`clinic_id`,`doctor_id`).

### `doctor_payouts` — doctor payments (revenue-share, phase 6-7)
`id`, `clinic_id` → clinics (`cascade`), `doctor_id` → users (`set null`),
`doctor_name` (**snapshot**), `amount` int (PKR), `method` (free-text —
cash/bank/cheque/other), `reference` (txn/cheque no.), `period_start` /
`period_end` date (optional; a period the payment covers), `note`, `created_by`
uuid (no FK) + `created_by_name` snapshot, `created_at`. One row per PAYMENT: an
AMOUNT-based running balance (Phase 7) — Earned = Σ `sale_shares.share_amount`
(lifetime), Paid = Σ these `amount`s, Outstanding = the difference. A payment is an
**arbitrary amount** (partial allowed), validated `0 < amount ≤ outstanding` by
`core/sales/payouts.ts#recordPayout`; `voidPayout` deletes the row → the balance
rises again. Clinic admin records/reverses from `/clinic/shares` (scoped to a
doctor) + prints a statement (`/clinic/shares/statement`); a doctor sees their own
read-only. Indexes: (`clinic_id`,`doctor_id`); (`clinic_id`,`created_at`).

### `discount_settlements` — doctor↔clinic discount bearing (discount-bearing, phase 1)
`id`, `clinic_id` → clinics (`cascade`), `appointment_id` → appointments (`cascade`),
`party` ('clinic' | 'doctor'), `doctor_id` → users (`set null`; NULL for the clinic
row), `doctor_name` (**snapshot**), `gross_share` int (party's pre-discount cut,
reference), `settlement_amount` int (**signed** balance adjustment; − = the party
bears a loss / a doctor may go into deficit), `occurred_at` (= scheduled_at),
`created_at`. One snapshot row per PARTY per completed appointment carrying an
effective discount. Captures the approved policy — whoever bears a discount absorbs it
fully (no spillover), computed as a **zero-sum transfer** on the NET bill + gross
shares (collection-independent), so Σ settlement = 0 and totals converge to make-whole
as the patient pays. Pure math in `core/appointments/discount-bearing.ts#computeBearing`;
written replace-all-per-appointment on the completion/edit/approval hooks (like
`sale_shares`). See `docs/discount-bearing-plan.md` §3. Indexes: (`appointment_id`);
(`clinic_id`,`occurred_at`); (`clinic_id`,`doctor_id`).

### `doctor_settlement_actions` — waives / repayments / write-offs (discount-bearing, phase 1)
`id`, `clinic_id` → clinics (`cascade`), `doctor_id` → users (`set null`),
`doctor_name` (**snapshot**), `appointment_id` → appointments (`set null`; NULL for a
standalone repayment/write-off), `line_ref` (procedure id | 'consultation' | NULL =
whole visit), `kind` ('doctor_waive' | 'clinic_waive' | 'repayment' | 'write_off' |
'reversal'), `amount` int (positive PKR; effect from `kind`), `reverses_id` (self-ref,
no FK — the row a reversal undoes), `note`, `created_by(+name)` snapshot, `occurred_at`,
`created_at`. The manual money moves on a doctor's share balance: a doctor forgoes his
own share (`doctor_waive`, by self-identity), the clinic forgives a deficit
(`clinic_waive`, a clinic cost) / records a doctor→clinic `repayment` / `write_off`, or
reverses any (`reversal`). Clinic-side kinds need the **`share_waive`** permission.
Indexes: (`clinic_id`,`doctor_id`); (`clinic_id`,`occurred_at`); (`appointment_id`);
**partial UNIQUE** (`appointment_id`,`line_ref`) `WHERE kind='doctor_waive' AND line_ref
IS NOT NULL AND appointment_id IS NOT NULL` — at most one per-line waive per line, so a
double-waive race can't create duplicates (migration `0042`).

### `patient_payments` — money in/out subledger (Finance, phase 1)
`id`, `clinic_id` → clinics (`cascade`), `patient_id` → patients (`cascade`),
`appointment_id` → appointments (`set null`; NULL = an unallocated **advance**),
`kind` (`payment` | `advance` | `advance_applied` | `refund`), `amount` int (PKR,
positive; sign from `kind`), `method` (cash/bank/cheque/other), `reference`, `note`,
`reverses_id` (nullable, self-ref for a void/refund), `occurred_at`, `created_by(+name)`
snapshot, soft-delete, timestamps. Collected on a visit = Σ(payment +
advance_applied) for that appointment; patient **credit** = Σadvance −
Σadvance_applied − Σrefund(unallocated). A void is a soft-delete; the
`appointments.amount_collected` cache is recomputed from the live ledger after every
change (no drift). See `core/billing/*`. Indexes: (`clinic_id`,`patient_id`);
(`appointment_id`); (`clinic_id`,`occurred_at`); partial trash index.

### `invoices` — numbered visit invoices (Finance, phase 1)
`id`, `clinic_id` → clinics (`cascade`), `appointment_id` → appointments (`cascade`),
`patient_id` → patients (`cascade`), `invoice_no` int (per-clinic sequence),
`issued_at`, `issued_by(+name)` snapshot, `note`, soft-delete. One LIVE invoice per
appointment (partial unique on `appointment_id WHERE deleted_at IS NULL`); the number
is allocated by locking the clinic row (`FOR UPDATE`) and bumping
`clinics.next_invoice_no`, shown with `clinics.invoice_prefix`. The bill amount is
NOT stored — derived from `computeBill` at render (thermal/A5/A4 print), the same
formula the lists aggregate in SQL. See
`core/billing/invoice.ts`. Indexes: unique(`clinic_id`,`invoice_no`);
(`clinic_id`,`issued_at`); (`patient_id`).

### `appointment_discount_approvals` — discount sign-off (revenue-share, phase 3)
`id`, `clinic_id` → clinics (`cascade`), `appointment_id` → appointments
(`cascade`), `approver_kind` ('clinic' | 'doctor'), `approver_doctor_id` → users (`cascade`; the
affected doctor for a 'doctor' row, NULL for a 'clinic' row),
`status` ('pending'|'approved'|'rejected', default pending),
`decided_by` uuid (no FK — users are soft-deleted) + `decided_by_name` snapshot +
`decided_at`, `note`, timestamps. One row per party (the clinic and/or each affected
doctor) that must sign off before an appointment's discount applies. Rows are
(re)generated on every discount/borne-by/procedures change by
`core/appointments/approvals.ts#syncDiscountApprovals`, which reads
`clinics.discount_needs_approval` (clinic side) and `users.discount_needs_approval`
(each affected doctor) to decide who is required; the appointment's
`discount_status` is derived from the rows. A doctor decides only their own row; a
'clinic' row needs the `discount_approval` permission. With all switches off + borne
= clinic, no rows are made → status 'none' → the discount just applies (behaviour
unchanged). Indexes: (`appointment_id`); (`clinic_id`,`status`);
(`approver_doctor_id`,`status`).

### `imported_transactions` — read-only financial-history archive (financial-archive-plan.md)
A clinic migrating off its old PMS uploads its old **bills / receipts / expenses /
doctor-payouts** as per-transaction rows so the past is searchable inside FlexicaAI forever.
**READ-ONLY archive — NEVER joined by a live report.** FlexicaAI's money
(sales/shares/receivables/P&L) is DERIVED from completed appointments; these rows never
happened *in FlexicaAI*, so they must not enter those ledgers (a separate table, not an
`imported` flag, makes exclusion the default). ONE generic table with a `type`
discriminator (not five per-entity tables): `id`, `clinic_id` → clinics (cascade), `type`
(free text — 'invoice'|'payment'|'refund'|'expense'|'doctor_payout'), `txn_date` date
(as given, nullable → a warning), `amount` int (PKR, **always positive**; `type` carries
direction — money in = payment, out to a patient = refund, expense/payout = out),
`patient_id` → patients (set null; matched by old-ref → phone → exact name, else archived
UNLINKED) + `patient_name`/`external_patient_ref` snapshots, `doctor_id` → users (set
null; matched by name) + `doctor_name` snapshot, `description`/`reference`/`method`, `raw`
jsonb (**the ENTIRE original row verbatim** — nothing lost, a future specialised report
recoverable without re-import), `import_batch_id` (undo group, no FK), soft-delete,
timestamps. Uploaded ADMIN-side (owner/super-admin/account-manager) via the clinic-detail
importer (`/admin/clinics/[id]/import`, gated by `import:create` + assignment scope),
reusing the whole import machinery (parse → map → dry-run preview **with a reconciliation
totals footer** → batch commit → undo). The clinic gets a READ-ONLY viewer
(`/clinic/history`, gated by the `sales` feature + `billing:view`) with a "Historical —
read-only" banner + type/period/text filters + CSV; `core/finance/imported-history.ts` is
the ONLY reader. The one sanctioned bridge to live data: an **opt-in** (default off) toggle
on the payments commit **SETS** (never adds) each affected patient's
`patients.opening_balance` = max(0, Σ imported invoices − Σ payments + Σ refunds), so the
flat and derived dues paths can't stack. Indexes: (`clinic_id`,`type`,`txn_date`);
`patient_id`; `doctor_id`; `import_batch_id`; pg_trgm on `patient_name`/`doctor_name`;
(`clinic_id`,`reference`); partial trash index. (Migration `0074`.)

---

## 3b. Super-admin control plane & Owner Finance

Company-side tables — how FlexicaAI runs its business (bill clinics, track its own
cost/profit). Some carry `clinic_id` (a tenant reference the super admin reads
cross-tenant via `unscoped`); several are **company-level (no `clinic_id`)** — FlexicaAI's
own data, which the tenant guard therefore ignores. See `docs/super-admin-plan.md`,
`docs/finance-plan.md` and `docs/owner-finance-plan.md`.

**Clinic/user columns added by this layer** (not new tables): `clinics` gained
subscription **billing** (`monthly_price`, `billing_cycle` = the package
monthly/2m/quarter/half/annual, `grace_days`, `payment_reminder_days` [days before the
paid-through date to show a "payment coming up" heads-up, default 5], lifecycle dates
`trial_start_at` / `trial_ends_at` / `activated_at` [= subscription/active start] +
`status`, invoice counter `next_invoice_no`/`invoice_prefix`/`invoice_paper`),
**account-manager** `assigned_to` → users (self-ref FK), a
**payment-commitment** follow-up (`payment_commitment_at`/`_note`), a **health
follow-up / snooze** for churn/usage-flag alerts (`health_followup_at`/`_note` — a
future date parks the clinic under "Following up" on the Owner Overview instead of
nagging in the at-risk/usage-flag lists; `core/admin/health.ts`), and **owner
contact** (`owner_name`/`_email`/`_phone`, `city`, `country`). `users` gained
`deactivated_at` (NULL+inactive = suspended · set+inactive = deactivated),
`permissions` (admin `resource:action` slugs — a NULL list on a super_admin = the
`owner`), `prefix`, `avatar_key`, and the doctor revenue-share `%` columns.

### `clinic_payments` — clinic → FlexicaAI subscription payments
`id`, `clinic_id` → clinics (`cascade`), `amount` int (PKR, always positive),
`kind` (`payment` = money in / `refund` = money out / `credit` = non-cash goodwill;
sign for the balance + cash-collected math comes from this), `method`, `reference`,
`months_covered`, `note`, `occurred_at`, `recorded_by(+name)` snapshot, soft-delete,
timestamps. Balance/status math in `core/admin/billing.ts` (advance/partial-payment,
`computeClinicBalance`); a refund subtracts from paid, a credit adds without cash.
Indexes: (`clinic_id`,`occurred_at`); partial trash index.

### `announcements` — super-admin → clinic notices
`id`, `clinic_id` → clinics (`cascade`, **nullable** — NULL = broadcast to ALL
clinics, else targeted), `level` (info|warning), `title`, `body`, `active` bool,
`starts_at`/`ends_at` (optional window), `created_by(+name)`, timestamps. Shown in the
clinic notice bar. `core/admin/announcements.ts` (cross-clinic reads `unscoped`).

### `platform_cost_rates` — company serving-cost config (Owner Finance) · NO clinic_id
`id`, ESTIMATE rates `scribe_call_cost` (fallback) + `whatsapp_msg_cost`, METERED rates
`whisper_minute_cost` + `claude_input_cost`/`claude_output_cost` (per 1M tokens), all
`numeric` USD; `currency`, `usd_to_pkr` FX; **international-transaction bank TAX/charges**
(`tax_mode` 'itemized'|'total' + `foreign_txn_fee_pct` / `fed_pct` / `advance_tax_pct` /
`additional_tax_pct` and `total_tax_pct`, all `numeric` %, default 0) applied as a **%
markup on the PKR serving cost at report time** (ai_usage stays the raw provider cost).
Itemised effective % = fee + **(FED on the fee)** + advance + additional (FED is charged
on the fee, not the payment — so 16% FED on a 3% fee = 0.48%); or the single total.
Pure/client-safe math in `core/admin/cost-tax.ts#effectiveTaxPct`/`taxMultiplier`
(`FILER_TAX_DEFAULTS` = 3% fee · 16% FED · 5% advance ≈ 8.48%, pre-filled but editable);
`effective_from` (a NEW row per change = rate history; latest = current),
`created_by(+name)`, `created_at`. Drives `computeServingCost` + the dashboard serving-cost
KPI (`metrics.ts`). Index: `effective_from`. (Tax cols: migration `0077`.)

### `ai_usage` — precise AI metering (Owner Finance)
`id`, `clinic_id` → clinics (`cascade`), `visit_id` → visits (`set null`), `provider`
('whisper'|'claude'), `model`, `audio_seconds` (Whisper), `input_tokens`/`output_tokens`
(Claude), `cost_pkr` int (**snapshot** at record-time rates), `occurred_at`. One
whisper + one claude row per scribe run (`core/ai/usage.ts#recordScribeUsage`,
best-effort). `computeServingCost` sums these (falls back to the flat estimate for an
audio visit with no metered row). Indexes: (`clinic_id`,`occurred_at`); (`occurred_at`);
(`visit_id`).

### `company_expense_categories` + `company_expenses` — FlexicaAI's own opex · NO clinic_id
Company operating costs (payroll/rent/software/…). `company_expense_categories`:
`id`, `name`, `is_active`. `company_expenses`: `id`, `category_id` → categories
(`set null`), `amount` int, `incurred_on` date, `vendor`, `method`, `reference`,
`note`, `recurring` + `recurrence` + `next_run_on` (cron `GET /api/cron/company-expenses`),
`created_by(+name)`, **soft-delete**, timestamps. `core/admin/company-expenses.ts`.
Indexes: `incurred_on`; `category_id`; partial trash + recurring-due indexes.

### `clinic_invoices` — FlexicaAI → clinic subscription invoices (Owner Finance)
`id`, `clinic_id` → clinics (`cascade`), `invoice_no` int (**company-global**
sequence, allocated by locking `company_settings` + bumping its counter — distinct
from patient `invoices`), `period_start`/`period_end` date, `amount` int, `note`,
`issued_at`, `issued_by(+name)`, **soft-delete** (a void keeps the number), `created_at`.
Printable receipt reuses the invoice frame. `core/admin/clinic-invoices.ts`. Indexes:
unique `invoice_no`; `clinic_id`; `issued_at`; partial trash index.

### `company_settings` — singleton company config · NO clinic_id
`id`, `next_invoice_no` + `invoice_prefix` (the `clinic_invoices` counter),
`churn_inactive_days` (Overview churn threshold default, 21), `thin_margin_pct` (50) +
`spike_multiple` (3) + `spike_floor_pkr` (200) (the Overview anomaly-flag rules),
timestamps. One row, seeded lazily. `core/admin/company-settings.ts`. The Owner
Overview (`/admin/overview`, `core/admin/health.ts` + `metrics.ts` + `pnl.ts`) reads
these for churn-risk + usage/cost anomaly flags.

---

## 4. Notes

- **Inferred types** are exported from `schema.ts` (`Clinic`, `User`, `Patient`,
  `Appointment`, `Visit`, `Recall`, `WhatsappMessage`, `DoctorLeave`, …) — import
  those rather than redefining row shapes.
- **Slot validation** (leave + working hours + daily cap) is centralised in
  `core/appointments/availability.ts#checkDoctorSlot`; both booking and the WhatsApp
  reschedule use it, so the rules can't drift.
- **Timezone caveat (deploy):** availability, "tomorrow" (reminder), and day
  bounds use the **server's local timezone**. For a multi-region rollout
  (Pakistan vs GCC), pin each clinic to its own timezone.
- Migrations `0000`–`0043` applied; almost always additive (the one drop:
  `0038` removes `sale_shares.payout_id`, superseded by amount-based payouts).
  `0039` adds the Finance billing foundation — `patient_payments` + `invoices`
  tables, `appointments.amount_collected`, and clinic invoice settings
  (`invoice_paper` / `invoice_prefix` / `next_invoice_no`). `0040` adds `expenses`
  (soft-deletable) + `expense_categories`. See docs/finance-plan.md. `0041`
  (discount-bearing phase 1) adds the `discount_settlements` + `doctor_settlement_actions`
  tables and `appointments.discount_split_type` / `discount_split_value` /
  `discount_split_stale`. See docs/discount-bearing-plan.md. `0042` adds the partial
  unique index on `doctor_settlement_actions` (one per-line doctor_waive per line).
  `0043` adds `expenses.recurrence` ('monthly'|'weekly') + `expenses.next_run_on`
  date (+ a partial due-index) — the recurring-expense cron
  (`core/expenses/recurring.ts`, `GET /api/cron/expenses`) clones a recurring
  template into a plain expense each period and advances `next_run_on`.
  (`0017` adds `appointments.discount_type` / `discount_value`; `0018` adds
  `appointments.queue_session` / `queue_number` + the queue unique index; `0019`
  adds the `activity_logs` table; `0020` adds `clinics.log_access` and drops the
  now-unused `activity_logs.visible` — log access is permission-based, not
  time-based; `0021` adds the `procedures` table; `0022` adds `appointment_procedures`;
  `0023` adds the `sales` ledger table; `0024` adds
  `appointments.charge_consultation`; `0025` adds
  `appointment_procedures.discount_type` / `discount_value` for per-line discounts;
  `0026` adds the `manager` user_role value + `users.permissions` (per-user ACL);
  `0027` adds soft-delete columns (`deleted_at`/`deleted_by`/`delete_group`/
  `deleted_by_cascade`) to the 8 deletable tables + `clinics.trash_retention_days`,
  makes `users` username/email uniqueness partial (`WHERE deleted_at IS NULL`), and
  adds per-table partial trash indexes; `0028` adds `patients.reference`; `0029`
  adds the per-clinic WhatsApp sender columns (`whatsapp_phone_number_id` [partial
  unique] / `whatsapp_display_number` / `whatsapp_sender_name` / `whatsapp_signature`);
  `0030` drops the unused `whatsapp_notes` (per-event notes feature removed);
  `0031` adds `users.prefix` (name title — Dr/Mr/Miss…, shown as "Dr. Bilal Aziz");
  `0032` adds `users.avatar_key` (profile picture, served self-only via
  GET /api/me/avatar; the `/account` self-service settings page); `0033` adds the
  doctor revenue-share foundation — `users.consultation_share_pct` /
  `procedure_share_pct`, `appointments.discount_borne_by`,
  `appointment_procedures.doctor_id` (performing doctor), and the
  `doctor_procedure_shares` table (per-doctor per-procedure % overrides). See
  `docs/doctor-shares-plan.md`; split math in `core/appointments/shares.ts`, rate
  config in `core/appointments/share-config.ts`. `0034` adds the discount-approval
  switches `users.discount_needs_approval` (per doctor) + `clinics.discount_needs_approval`
  (per clinic). `0035` adds `appointments.discount_status` + the
  `appointment_discount_approvals` table (the discount approval workflow —
  `core/appointments/approvals.ts`). `0036` adds the `sale_shares` per-doctor share
  ledger (`core/sales/share-ledger.ts`). `0037` adds the `doctor_payouts` table +
  the `sale_shares.payout_id` FK (`core/sales/payouts.ts`) — completing the doctor
  revenue-share v1. `0038` (Phase 7) switches payouts to an AMOUNT-based running
  balance: drops `sale_shares.payout_id`, adds `doctor_payouts.method`/`reference`
  — arbitrary/partial payments + a printable statement.)
- Migrations **`0044`–`0063`** — the **super-admin control plane + Owner Finance**
  (see §3b; `docs/super-admin-plan.md`, `docs/owner-finance-plan.md`). Roughly:
  `0044`–`0053` build the super-admin panel — clinic subscription **billing**
  (`clinic_payments` + the `clinics` billing columns), **2FA/security**, the admin
  **ACL** (`users.permissions` admin slugs), clinic **capabilities**/features,
  owner **contact** columns, **impersonation**, company **metrics**, and
  **`announcements`** (`0053`). `0054` adds `clinics.payment_commitment_at/_note`;
  `0055` adds `clinics.assigned_to` (account manager, self-ref FK); `0056` adds
  `users.deactivated_at` (suspend vs deactivate). Owner Finance: `0057`
  `platform_cost_rates`; `0058` `company_expenses` + `company_expense_categories`;
  `0059` `company_settings` + `clinic_invoices`; `0060` `clinic_payments.kind`
  (payment/refund/credit → cash-aware collected); `0061` `ai_usage` + the metered
  Whisper/Claude rate columns on `platform_cost_rates`; `0062`
  `company_settings.churn_inactive_days`; `0063` `company_settings` anomaly-flag
  thresholds (`thin_margin_pct`/`spike_multiple`/`spike_floor_pkr`).
- Migration **`0069`** adds `clinics.health_followup_at`/`health_followup_note` —
  the Owner Overview churn/usage-flag follow-up (snooze). A future date moves the
  clinic to the "Following up" list and out of the at-risk/usage-flag alerts until
  it passes. `core/admin/health.ts` (`getClinicHealth` + `setHealthFollowup`).
- Migration **`0070`** adds `clinics.payment_notice_enabled` (bool, default true) —
  whether the SOFT payment-due/overdue reminder is shown to the clinic's own staff
  (a bottom pill in the workspace). Owner / super-admin / the account manager toggle
  it per clinic; it does not affect the super-admin dues dashboard or the hard
  `past_due` lock. `core/admin/billing.ts#setPaymentNoticeEnabled`, gated in
  `src/app/clinic/layout.tsx`.
- Migration **`0071`** adds `clinics.logo_key` (text, nullable) — the clinic's logo
  (opaque local-FS storage key, per-clinic `logo/` subdir; cap 1 MB, see
  `core/clinics/logo-limits.ts`). Uploaded by owner/super-admin/account-manager (clinic
  detail "Logo" card + optionally the new-clinic form); printed **as uploaded** at the
  top of invoices/receipts (a B&W/thermal printer renders it mono), inlined as a base64
  data URI for print reliability (`core/clinics/logo.ts#getClinicLogoDataUri`); the admin
  preview is served via `GET /api/admin/clinics/[id]/logo`. NULL = print nothing.
- Migration **`0072`** — patient-invoice numbers **reset per year**. Adds
  `clinics.invoice_year` (the year `next_invoice_no` belongs to) + `invoices.invoice_year`,
  and swaps the invoice unique index to (`clinic_id`,`invoice_year`,`invoice_no`) since the
  number restarts at 1 each January. Label is now `<invoice_prefix><YYYY>-<7-digit>` (e.g.
  `INV-2026-0000005`, `core/billing/invoice.ts#formatInvoiceNo`); allocation locks the
  clinic row and resets on a year rollover. Existing invoices backfilled (`invoice_year`
  from `issued_at`) and re-rendered in the new format. (Distinct from the company-side
  `clinic_invoices`, which keeps its own global numbering.)
- Migration **`0073`** — **payment-receipt numbering** (RCP series, distinct from
  invoices). Adds `clinics.receipt_prefix`/`next_receipt_no`/`receipt_year` +
  `appointments.receipt_no`/`receipt_year` (partial-unique per clinic+year). The number
  is allocated ONCE on the first money-in for a visit (`core/billing/payments.ts#ensureReceiptNumber`,
  clinic-row-locked, resets per year) → label `<receipt_prefix><YYYY>-<7-digit>` (e.g.
  `RCP-2026-0000012`, `formatReceiptNo`). Existing paid visits backfilled. The receipt
  prints the RCP # + a per-payment breakdown; the `/clinic/payments` ledger is searchable
  by payment # (RCP) and MRN #.
- Migration **`0074`** — the **read-only financial-history archive**: adds the
  `imported_transactions` table (see §3). One generic table (type discriminator + `raw`
  jsonb) for a clinic's pre-FlexicaAI bills/receipts/expenses/doctor-payouts, uploaded
  admin-side via the existing clinic-detail importer (four new `ImportEntity` passes —
  `fin_invoice`/`fin_payment`/`fin_expense`/`fin_payout` — all writing this one table,
  undo via `import_batches`), viewed read-only at `/clinic/history`. Excluded from every
  live report by construction; the only bridge is the opt-in `opening_balance` derivation.
  See docs/financial-archive-plan.md.
- Migration **`0075`** adds `clinics.trial_start_at` (timestamptz) — when a clinic first
  enters `trial` (stamped by `setClinicStatus`/`extendTrial`, never overwritten; existing
  trial clinics backfilled from `created_at`). Distinct from `created_at`; pairs with
  `activated_at` (active/subscription start). The super-admin **clinics list** (`/admin`)
  now shows trial-start / active-start / **first payment** (earliest `clinic_payments`
  payment via `getFirstPaymentDates`) / **package** (`billing_cycle`); the two billing
  columns are billing-viewer-only, and the wide table scrolls horizontally.
- Migration **`0076`** adds `clinics.payment_reminder_days` (int, default 5) — how many
  days before the paid-through date a still-paid clinic surfaces in **"Payments coming
  up"** on `/admin` + `/admin/overview` (a pre-due heads-up, distinct from due/overdue).
  Set per clinic on the billing card (owner/super-admin/account-manager, `setPayment
  ReminderDaysAction`); `listDueClinics({ includeUpcoming })` adds the `upcoming` alert
  bucket (an `active` clinic with `daysRemaining ≤ payment_reminder_days`). 0 disables it.
- Migration **`0077`** adds international-transaction **bank tax/charge** columns to
  `platform_cost_rates` — `tax_mode` ('itemized'|'total') + `foreign_txn_fee_pct` /
  `fed_pct` / `advance_tax_pct` / `additional_tax_pct` / `total_tax_pct` (all `numeric`,
  default 0). The effective % (summed itemised, or the single total) is a **markup on the
  PKR serving cost** (a PK bank deducts a foreign-transaction fee + FED + advance tax when
  FlexicaAI pays the AI/WhatsApp providers in USD); applied in `computeServingCost` +
  `getCompanyMetrics` via `core/admin/cost.ts#taxMultiplier`. Editable on
  `/admin/finance/costs`. Verified: itemised 10% and total 8% scale the cost exactly; 0 = no change.
