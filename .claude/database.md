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

---

## 2. Enums

| Enum | Values |
|---|---|
| `user_role` | super_admin, clinic_admin, doctor, receptionist |
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
e.g. `{revenue_dashboard}` — see `core/lib/features.ts`), `avg_visit_value` int
(PKR, default 3000; drives "Revenue Recovered"), timestamps.
Index: GIN pg_trgm on `name` (fast ILIKE search).

### `users` — staff accounts
`id`, `clinic_id` → clinics (**nullable**; NULL for super_admin; `on delete set
null`), `username` (**unique**, lowercased), `email` (**unique when present**),
`password_hash` (bcrypt), `role` (enum), `full_name`, `is_active` (default true),
`must_change_password` (default false), `theme` (enum). **Doctor-only fields:**
`availability` jsonb `DayAvailability[]` (per-weekday working windows; empty = no
restriction — `core/lib/availability.ts`), `daily_appointment_limit` int (0 =
unlimited), `consultation_fee` int (PKR, 0 = not set). Timestamps.
Indexes: unique `username`, unique `email`, `clinic_id`.

### `sessions` — server-side sessions
`id`, `user_id` → users (`on delete cascade`), `token_hash` (**unique**; SHA-256 of
the opaque cookie token), `expires_at`, `created_at`. Validated per request in Node
(not the Edge proxy). Indexes: unique `token_hash`, `user_id`, `expires_at`.

### `patients` — shared across specialties
`id`, `clinic_id` → clinics (`cascade`), `full_name`, `phone` (WhatsApp number,
primary contact), `email`, `date_of_birth`, `gender`, `address`, `notes`,
`data_consent` (default false), timestamps.
Indexes: `clinic_id`; (`clinic_id`,`phone`); (`clinic_id`,`full_name`); GIN pg_trgm
on `full_name` and `phone`.

### `appointments` — shared
`id`, `clinic_id` → clinics (`cascade`), `patient_id` → patients (`cascade`),
`doctor_id` → users (`set null`), `module` (free-text tag), `scheduled_at`,
`duration_minutes` (default 30), `status` (enum, default scheduled), `reason`,
`reminder_sent_at` (set once the day-before reminder is sent; NULL = not reminded),
timestamps.
Indexes: `clinic_id`; `patient_id`; (`clinic_id`,`scheduled_at`); `doctor_id`;
(`scheduled_at`,`reminder_sent_at`) for the reminder cron.

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
- Migrations `0000`–`0014` applied; new tables/columns are always additive to core.
