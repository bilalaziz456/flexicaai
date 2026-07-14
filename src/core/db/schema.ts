import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { DayAvailability } from "@/core/lib/availability";

/**
 * Drizzle schema — the single source of truth for the database structure.
 * Migrations are GENERATED from this file (drizzle-kit generate). Never hand-edit
 * the database; change it here and generate a migration.
 *
 * CORE, specialty-agnostic. Only shared platform tables live here. Specialty
 * data (e.g. dental tooth charts) goes in module-owned tables later and never
 * as columns on these core tables (CLAUDE.md §5).
 *
 * This rework introduces the tables auth needs now: clinics, users, sessions.
 * Step 3 adds patients, appointments, visits, recalls (and any extra clinic
 * columns) — additively, without changing these.
 */

/** Platform roles. Independent of which modules a clinic enables. */
export const userRole = pgEnum("user_role", [
  "super_admin",
  "clinic_admin",
  "manager",
  "doctor",
  "receptionist",
]);

/** Per-user theme preference. "system" follows the OS. */
export const themePreference = pgEnum("theme_preference", [
  "system",
  "light",
  "dark",
]);

/**
 * Soft-delete columns — CORE. Nothing in the app is ever hard-deleted (the only
 * exception is a super-admin LEGAL purge). A deleted row keeps `deletedAt` = when
 * it was trashed (NULL = live); every normal read filters `deletedAt IS NULL`.
 *
 * - `deletedBy`  — the user who trashed it (plain uuid, no FK: users are
 *   themselves soft-deleted, so we never lose the referent, and we avoid FK churn).
 * - `deleteGroup` — one id shared by a parent and the child rows its deletion
 *   cascade-hid, so **Restore reverts exactly that batch** (a row trashed on its
 *   own has its own group and is never revived by an unrelated parent restore).
 * - `deletedByCascade` — true for rows hidden ONLY because a parent was trashed;
 *   the Trash list shows only the non-cascade (directly-deleted) rows.
 *
 * Spread `...softDeleteColumns()` into every soft-deletable table.
 */
const softDeleteColumns = () => ({
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: uuid("deleted_by"),
  deleteGroup: uuid("delete_group"),
  deletedByCascade: boolean("deleted_by_cascade").notNull().default(false),
});

/**
 * Tenants. `modulesEnabled` is the array the specialty checkboxes read/write —
 * e.g. ['dental']. Core code checks this list but never hardcodes a specialty.
 */
export const clinics = pgTable(
  "clinics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    // text[] of module ids, e.g. {dental}. Empty until a specialty is enabled.
    modulesEnabled: text("modules_enabled")
      .array()
      .notNull()
      .default([]),
    // text[] of optional platform-feature ids the super admin has switched on
    // for this clinic, e.g. {revenue_dashboard}. Specialty-agnostic (works for
    // dental/derma/hair alike) and off by default — see core/lib/features.ts.
    featuresEnabled: text("features_enabled")
      .array()
      .notNull()
      .default([]),
    // text[] of activity-log ACTION categories the clinic admin is allowed to
    // see (e.g. {login,view,update,delete}). Empty = the clinic has NO log
    // access. Granted per-clinic by the super admin — see core/audit/access.ts.
    logAccess: text("log_access").array().notNull().default([]),
    // Owner-set average revenue per visit (whole PKR). Drives the owner
    // dashboard's "Revenue Recovered" metric (recovered return visits × this).
    avgVisitValue: integer("avg_visit_value").notNull().default(3000),
    // How many days a trashed record stays in this clinic's Trash before it drops
    // out of the clinic-level view (still in the DB — only the super admin sees it
    // past this window). Super-admin-set; default 30. Never auto-purged.
    trashRetentionDays: integer("trash_retention_days").notNull().default(30),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Fast case-insensitive contains-search (ILIKE '%q%') on name via pg_trgm.
    // A plain btree can't serve a leading-wildcard LIKE; a GIN trigram index can.
    index("clinics_name_trgm_idx").using("gin", t.name.op("gin_trgm_ops")),
    // Trash listing (super admin): only the trashed rows.
    index("clinics_deleted_idx")
      .on(t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

/**
 * Staff accounts. Role + clinicId are the authorization anchors (CLAUDE.md §5).
 * clinicId is NULL for super_admin (company staff belong to no single clinic).
 * Passwords are bcrypt hashes — never store plaintext.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // No FK-level cascade choice yet for super_admin (null); set null on clinic delete.
    clinicId: uuid("clinic_id").references(() => clinics.id, {
      onDelete: "set null",
    }),
    // Login identifier — a short handle like "admin" (not an email).
    username: text("username").notNull(),
    // Optional contact email (for future notifications / password reset).
    email: text("email"),
    passwordHash: text("password_hash").notNull(),
    role: userRole("role").notNull(),
    fullName: text("full_name"),
    isActive: boolean("is_active").notNull().default(true),
    // Set true when an admin creates the account with a temporary password;
    // cleared once the user sets their own (forced on first login).
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    // Per-user permission slugs ("resource:action"). NULL = fall back to the
    // role's defaults (see core/auth/permissions.ts); a non-null array is an
    // admin override that fully replaces those defaults. Free-text (not enums)
    // so the catalog can grow without a schema change.
    permissions: text("permissions").array(),
    // UI theme preference; "system" follows the OS.
    theme: themePreference("theme").notNull().default("system"),
    // Doctor scheduling (specialty-agnostic, core/lib/availability.ts). Empty for
    // non-doctors and for doctors with no restriction. `availability` is the
    // per-weekday working windows; `dailyAppointmentLimit` caps bookings per day
    // (0 = unlimited). Both only meaningful for role = doctor.
    availability: jsonb("availability")
      .$type<DayAvailability[]>()
      .notNull()
      .default([]),
    // When true, the doctor can be booked at ANY time — the working-hours in
    // `availability` are not enforced (leave and the daily cap still apply). When
    // false, appointments may only be made during those visiting hours.
    flexibleHours: boolean("flexible_hours").notNull().default(false),
    dailyAppointmentLimit: integer("daily_appointment_limit")
      .notNull()
      .default(0),
    // Doctor's consultation fee in whole PKR (0 = not set). Per-doctor.
    consultationFee: integer("consultation_fee").notNull().default(0),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Username is the login credential — globally unique, stored lowercased.
    // PARTIAL: a trashed user keeps its row, so uniqueness ignores deleted rows —
    // otherwise the username/email could never be reused after a soft delete.
    uniqueIndex("users_username_unique")
      .on(table.username)
      .where(sql`${table.deletedAt} is null`),
    // Email is optional; unique when present (Postgres treats NULLs as distinct).
    uniqueIndex("users_email_unique")
      .on(table.email)
      .where(sql`${table.deletedAt} is null`),
    // Multi-tenant lookups filter by clinic_id constantly — index it.
    index("users_clinic_id_idx").on(table.clinicId),
    // Trash listing per clinic: only trashed staff.
    index("users_deleted_idx")
      .on(table.clinicId, table.deletedAt)
      .where(sql`${table.deletedAt} is not null`),
  ],
);

/**
 * Server-side sessions. The browser holds only an opaque random token in an
 * HTTP-only cookie; we store its SHA-256 hash here (so a DB leak can't be used
 * to impersonate users). Validated per request in Node (not in the Edge proxy).
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

/**
 * Patients — shared across all specialties (CLAUDE.md §5). One patient may use
 * multiple modules at the same clinic. `phone` is the WhatsApp number (primary
 * contact channel for recalls). Specialty clinical data never lives here.
 */
export const patients = pgTable(
  "patients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    // E.164 WhatsApp number (e.g. +9230…). Primary contact for reminders.
    phone: text("phone"),
    email: text("email"),
    dateOfBirth: date("date_of_birth"),
    gender: text("gender"),
    address: text("address"),
    notes: text("notes"),
    // How the patient was referred (free text) — e.g. "Dr. Khan", "Instagram",
    // another patient's name. Optional; for referral tracking.
    reference: text("reference"),
    // Consent for data use (CLAUDE.md §10). Photo consent added by modules that need it.
    dataConsent: boolean("data_consent").notNull().default(false),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("patients_clinic_id_idx").on(t.clinicId),
    // Tenant-scoped lookups by phone / name are common in reception search.
    index("patients_clinic_phone_idx").on(t.clinicId, t.phone),
    index("patients_clinic_name_idx").on(t.clinicId, t.fullName),
    // Fast ILIKE '%q%' contains-search on name and phone (pg_trgm GIN).
    index("patients_name_trgm_idx").using("gin", t.fullName.op("gin_trgm_ops")),
    index("patients_phone_trgm_idx").using("gin", t.phone.op("gin_trgm_ops")),
    // Trash listing per clinic: only trashed patients.
    index("patients_deleted_idx")
      .on(t.clinicId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

/** Appointment lifecycle. */
export const appointmentStatus = pgEnum("appointment_status", [
  "scheduled",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
]);

/**
 * Appointments — shared. `module` tags which specialty the appointment is for
 * (e.g. 'dental'). It is deliberately a free-text tag, NOT an enum: core must
 * stay module-agnostic and new specialties must not require a schema change.
 */
export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    doctorId: uuid("doctor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    module: text("module"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(30),
    status: appointmentStatus("status").notNull().default("scheduled"),
    reason: text("reason"),
    // Optional discount off the doctor's consultation fee for this appointment.
    // `discountType` is 'amount' (flat PKR, the default) or 'percent' (of the
    // fee); `discountValue` is the raw figure (e.g. 500, or 20 for 20%). The net
    // fee is derived live from the doctor's current fee — see
    // core/appointments/fee.ts#computeFee — never stored, so a fee change flows
    // through. Kept as free-text/int (not an enum) to stay additive.
    discountType: text("discount_type").notNull().default("amount"),
    discountValue: integer("discount_value").notNull().default(0),
    // Whether the doctor's consultation fee is charged for this visit. A patient
    // who comes only for a procedure has no consultation fee → set false and the
    // bill/sale count only the procedures. Default true (charge, as before).
    chargeConsultation: boolean("charge_consultation").notNull().default(true),
    // How the appointment was created — free-text tag, default 'staff'. Patient
    // WhatsApp self-bookings are 'whatsapp': those stay a request until staff
    // confirm, and the patient's confirmation message fires on that confirm.
    source: text("source").notNull().default("staff"),
    // Set when the day-before WhatsApp reminder has been sent, so the reminder
    // cron never messages the same appointment twice. Null = not yet reminded.
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    // Patient queue token. `queueSession` groups a doctor's appointments for a
    // single visiting WINDOW on a day (key: `${doctorId}:${YYYY-MM-DD}:w{idx}`,
    // or `:day` for a flexible/no-window doctor); `queueNumber` is the FCFS
    // position within that session (assigned at booking, stable across
    // cancellations). Both NULL when no doctor is assigned. See
    // core/appointments/queue.ts.
    queueSession: text("queue_session"),
    queueNumber: integer("queue_number"),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("appointments_clinic_id_idx").on(t.clinicId),
    index("appointments_patient_id_idx").on(t.patientId),
    // Calendar/day views query by clinic + time window.
    index("appointments_clinic_scheduled_idx").on(t.clinicId, t.scheduledAt),
    index("appointments_doctor_id_idx").on(t.doctorId),
    // Trash listing per clinic: only trashed appointments (directly deleted).
    index("appointments_deleted_idx")
      .on(t.clinicId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
    // The reminder cron scans "active, un-reminded, scheduled within a window".
    index("appointments_reminder_scan_idx").on(t.scheduledAt, t.reminderSentAt),
    // Queue tokens are unique within a (clinic, session). NULLs are distinct in
    // Postgres, so un-queued (no-doctor) rows never collide. Also serves as the
    // lookup index for "max number in this session" during assignment.
    uniqueIndex("appointments_queue_unique").on(
      t.clinicId,
      t.queueSession,
      t.queueNumber,
    ),
  ],
);

/** AI notes are DRAFT until a doctor approves them (CLAUDE.md §8). */
export const visitStatus = pgEnum("visit_status", ["draft", "approved"]);

/**
 * Visits — shared; stores the generated note. `module` tags specialty. The
 * structured note is JSONB whose SHAPE is defined by the module (dental note
 * shape ≠ derma), keeping core specialty-agnostic. Specialty relational data
 * (e.g. tooth-chart rows) goes in a module table linked to the visit, not here.
 */
export const visits = pgTable(
  "visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id").references(() => appointments.id, {
      onDelete: "set null",
    }),
    doctorId: uuid("doctor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    module: text("module"),
    status: visitStatus("status").notNull().default("draft"),
    // Raw Whisper transcript kept for the accuracy flywheel (CLAUDE.md §8).
    transcript: text("transcript"),
    // Module-shaped structured note (the doctor's approved/edited version).
    note: jsonb("note").$type<Record<string, unknown>>(),
    // The AI's ORIGINAL draft, frozen at generation time. Diffing it against
    // `note` yields the doctor's edits — the accuracy flywheel (CLAUDE.md §8).
    aiDraft: jsonb("ai_draft").$type<Record<string, unknown>>(),
    // Storage key of the source audio (for the flywheel / re-transcription).
    audioKey: text("audio_key"),
    visitDate: timestamp("visit_date", { withTimezone: true })
      .notNull()
      .defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("visits_clinic_id_idx").on(t.clinicId),
    index("visits_patient_id_idx").on(t.patientId),
    index("visits_clinic_date_idx").on(t.clinicId, t.visitDate),
    index("visits_appointment_id_idx").on(t.appointmentId),
    // Trash listing per clinic: only trashed visits.
    index("visits_deleted_idx")
      .on(t.clinicId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

/** Recall lifecycle — the recall engine reads and advances these. */
export const recallStatus = pgEnum("recall_status", [
  "pending",
  "scheduled",
  "sent",
  "booked",
  "completed",
  "cancelled",
]);

/**
 * Recalls — shared. The recall engine (core) reads these, applies each module's
 * rules, and sends reminders. `module` tags specialty; `reason` is human text
 * like '6-month cleaning'. `sourceVisitId` links back to the visit that created it.
 */
export const recalls = pgTable(
  "recalls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    sourceVisitId: uuid("source_visit_id").references(() => visits.id, {
      onDelete: "set null",
    }),
    module: text("module"),
    reason: text("reason"),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    status: recallStatus("status").notNull().default("pending"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("recalls_clinic_id_idx").on(t.clinicId),
    index("recalls_patient_id_idx").on(t.patientId),
    // The engine scans "what's due for this clinic up to date X".
    index("recalls_clinic_due_idx").on(t.clinicId, t.dueAt),
    index("recalls_status_idx").on(t.status),
    // Trash listing per clinic: only trashed recalls.
    index("recalls_deleted_idx")
      .on(t.clinicId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

/** Direction of a WhatsApp message relative to the clinic. */
export const whatsappDirection = pgEnum("whatsapp_direction", [
  "inbound",
  "outbound",
]);

/** Delivery lifecycle for a WhatsApp message (mirrors provider statuses). */
export const whatsappStatus = pgEnum("whatsapp_status", [
  "queued",
  "sent",
  "delivered",
  "read",
  "failed",
  "received",
]);

/**
 * WhatsApp message log — shared/core. Every send is recorded (so nothing is lost
 * even when the provider is unconfigured) and every inbound message/status is
 * stored here. This is also the source for the receptionist's WhatsApp queue
 * (Step 11). `clinicId`/`patientId` are nullable because an inbound message from
 * an unknown number can't always be attributed yet.
 */
export const whatsappMessages = pgTable(
  "whatsapp_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id").references(() => clinics.id, {
      onDelete: "cascade",
    }),
    patientId: uuid("patient_id").references(() => patients.id, {
      onDelete: "set null",
    }),
    direction: whatsappDirection("direction").notNull(),
    // E.164-ish destination/sender (digits, country code included).
    phone: text("phone").notNull(),
    status: whatsappStatus("status").notNull().default("queued"),
    // AiSensy campaign / template used (outbound), if any.
    templateName: text("template_name"),
    // Human-readable body / preview text.
    body: text("body"),
    mediaUrl: text("media_url"),
    // Provider message id, for status correlation.
    externalId: text("external_id"),
    error: text("error"),
    // Raw provider payload, for debugging / audit.
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("wa_messages_clinic_id_idx").on(t.clinicId),
    index("wa_messages_patient_id_idx").on(t.patientId),
    index("wa_messages_phone_idx").on(t.phone),
    // The reception queue reads newest-first per clinic.
    index("wa_messages_clinic_created_idx").on(t.clinicId, t.createdAt),
    index("wa_messages_external_id_idx").on(t.externalId),
  ],
);

/**
 * Doctor leave / vacation — shared/core. A row marks a doctor unavailable across
 * an inclusive date range [startDate, endDate] (a single day sets both equal).
 * Set by the receptionist or clinic admin; booking is blocked on these days and
 * existing appointments in the range are cancelled when the leave is created.
 */
export const doctorLeaves = pgTable(
  "doctor_leaves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    reason: text("reason"),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("doctor_leaves_clinic_id_idx").on(t.clinicId),
    // The booking guard asks "is THIS doctor on leave on date X".
    index("doctor_leaves_doctor_range_idx").on(
      t.doctorId,
      t.startDate,
      t.endDate,
    ),
    // Trash listing per clinic: only trashed leave entries.
    index("doctor_leaves_deleted_idx")
      .on(t.clinicId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

/**
 * Priced procedures/treatments a clinic offers (e.g. "Cleaning", "Root canal").
 * CORE + specialty-agnostic: the STRUCTURE is generic (a named priced service);
 * the specialty only supplies suggested defaults (see the module registry). Each
 * clinic manages its own list + prices. `module` tags the specialty for later
 * per-specialty reporting. Gated by the `sales` feature (core/lib/features.ts).
 */
export const procedures = pgTable(
  "procedures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Price in whole PKR.
    price: integer("price").notNull().default(0),
    module: text("module"),
    // Inactive procedures are hidden from booking but kept for history.
    isActive: boolean("is_active").notNull().default(true),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("procedures_clinic_id_idx").on(t.clinicId),
    // The booking picker lists a clinic's ACTIVE procedures.
    index("procedures_clinic_active_idx").on(t.clinicId, t.isActive),
    // Trash listing per clinic: only trashed procedures.
    index("procedures_deleted_idx")
      .on(t.clinicId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

/**
 * Sales ledger — one row per COMPLETED appointment (the `sales` feature). The
 * amounts are SNAPSHOTTED when the appointment is marked completed (doctor's
 * consultation fee + Σ procedures, minus discount), so a later fee/discount/
 * procedure edit or a catalog price change never rewrites historical revenue.
 * `occurred_at` is the visit date (the appointment's scheduled time). A sale is
 * removed when the appointment leaves "completed" (or is deleted — FK cascade).
 */
export const sales = pgTable(
  "sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    doctorId: uuid("doctor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    doctorName: text("doctor_name"), // snapshot
    grossAmount: integer("gross_amount").notNull().default(0),
    discountAmount: integer("discount_amount").notNull().default(0),
    netAmount: integer("net_amount").notNull().default(0),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One sale per appointment (upserted on completion).
    uniqueIndex("sales_appointment_unique").on(t.appointmentId),
    // The report aggregates by clinic + date window.
    index("sales_clinic_occurred_idx").on(t.clinicId, t.occurredAt),
    index("sales_doctor_idx").on(t.doctorId),
  ],
);

/**
 * Line items linking an appointment to the priced procedures it's booked for /
 * had done (the `sales` feature). Name + unit price are SNAPSHOTTED so editing
 * or deleting the catalog procedure never rewrites past appointments/sales.
 * `clinic_id` is carried for cheap per-procedure reporting without joining
 * appointments. Appointment total = doctor's consultation fee + Σ(unit×qty);
 * the appointment's discount then applies to that total.
 */
export const appointmentProcedures = pgTable(
  "appointment_procedures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    procedureId: uuid("procedure_id").references(() => procedures.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(), // snapshot
    unitPrice: integer("unit_price").notNull().default(0), // snapshot, PKR
    quantity: integer("quantity").notNull().default(1),
    // Optional per-line discount, applied to THIS line's gross (unit_price×qty)
    // BEFORE the appointment-level discount. 'amount' = flat PKR, 'percent' = %
    // of the line. Free-text/int (not enums) to stay additive.
    discountType: text("discount_type").notNull().default("amount"),
    discountValue: integer("discount_value").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("appt_procedures_appointment_idx").on(t.appointmentId),
    index("appt_procedures_clinic_idx").on(t.clinicId),
    index("appt_procedures_procedure_idx").on(t.procedureId),
  ],
);

/**
 * Activity / audit log — CORE, platform-wide. Records staff actions (create /
 * update / delete / login / view) so a clinic admin can audit their clinic and
 * the super admin has the full platform trail. Actor identity is SNAPSHOTTED
 * (`actorName`/`actorRole`) so the row survives the user being renamed/deleted.
 *
 * Access is PERMISSION-based (not time-based): the super admin grants each
 * clinic a set of visible action categories via `clinics.log_access`; a clinic
 * admin sees only those categories for their own clinic. The super admin always
 * sees everything, across all clinics. See core/audit/access.ts.
 */
export const activityLogs = pgTable(
  "activity_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Which clinic the action belongs to (NULL for pure super-admin actions).
    clinicId: uuid("clinic_id").references(() => clinics.id, {
      onDelete: "cascade",
    }),
    // Who did it — FK for joins, plus a snapshot that outlives the user.
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorName: text("actor_name").notNull(),
    actorRole: text("actor_role"),
    action: text("action").notNull(), // create | update | delete | login | view | status
    entity: text("entity"), // patient | appointment | staff | clinic | settings | session | …
    entityId: uuid("entity_id"),
    summary: text("summary").notNull(), // human-readable line
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Log views filter by clinic + date window (default today), newest first.
    index("activity_logs_clinic_created_idx").on(t.clinicId, t.createdAt),
    // Global (super-admin) date-window scan across clinics.
    index("activity_logs_created_idx").on(t.createdAt),
    index("activity_logs_actor_idx").on(t.actorUserId),
  ],
);

// Inferred row types for use across the app.
export type Clinic = typeof clinics.$inferSelect;
export type ActivityLog = typeof activityLogs.$inferSelect;
export type Procedure = typeof procedures.$inferSelect;
export type AppointmentProcedure = typeof appointmentProcedures.$inferSelect;
export type Sale = typeof sales.$inferSelect;
export type DoctorLeave = typeof doctorLeaves.$inferSelect;
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Patient = typeof patients.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type Visit = typeof visits.$inferSelect;
export type Recall = typeof recalls.$inferSelect;
export type WhatsappMessage = typeof whatsappMessages.$inferSelect;
