# Database schema — Klenic

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
  `procedures`, `doctor_leaves`. **Every normal read must filter `deleted_at IS
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
then the appointment's own discount applies to that subtotal — all in
`core/appointments/fee.ts` (`computeProcedureLine` / `computeBill`;
`computeSaleAmounts` for the ledger's gross/discount/net snapshot). To keep the many
callers a single fast aggregate (not N queries), the per-row net is expressed in SQL
by `procedures.ts#procedureRowNetSql` (mirrors `computeProcedureLine` exactly), with
correlated `appointmentProceduresNetSql` / `appointmentProceduresGrossSql` helpers
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
via `computeAppointmentTotal` = fee + procedures − discount), `occurred_at`
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
`payout_id` uuid (nullable, **no FK yet** — the `doctor_payouts` table lands in
phase 6; NULL = unpaid), `created_at`. One row per DOCTOR who earned a positive
share on a **completed** appointment — the CLINIC's cut is derived (sale net − Σ
these rows), so there is no clinic row. Snapshotted at completion via
`core/appointments/shares.ts#computeShare` on the **approval-gated** net, so later
rate/discount edits never rewrite history. Written by `core/sales/share-ledger.ts`,
folded into `recordSaleForAppointment` / `voidSaleForAppointment` /
`backfillClinicSales` so it stays in lockstep with the `sales` ledger (recording
REPLACES all rows for the appointment; a multi-doctor visit yields several).
**Inert** when no doctor has a share % (no rows). Indexes: (`appointment_id`);
(`clinic_id`,`occurred_at`); (`doctor_id`,`payout_id`).

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
- Migrations `0000`–`0036` applied; new tables/columns are always additive to core.
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
  ledger (`core/sales/share-ledger.ts`).)
