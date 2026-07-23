import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { DayAvailability } from "@/core/lib/availability";
import type { Allergy, Medication } from "@/core/lib/medical-history";

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
 * Spread `...softDeleteColumns()` into every soft-deletable table. Exported so
 * MODULE-owned tables (e.g. dental_records) reuse the exact same four columns.
 */
export const softDeleteColumns = () => ({
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
    // Billing/invoice settings (Finance). `invoicePaper` is the default print size
    // (a4|a5|thermal); `invoicePrefix` prefixes the human invoice label (e.g.
    // "INV-"); `nextInvoiceNo` is the per-clinic counter atomically bumped when an
    // invoice is issued (so concurrent receptionists never collide). See core/billing.
    invoicePaper: text("invoice_paper").notNull().default("a4"),
    invoicePrefix: text("invoice_prefix").notNull().default("INV-"),
    nextInvoiceNo: integer("next_invoice_no").notNull().default(1),
    // When true, a CLINIC-borne discount needs approval (from a `discount_approval`
    // grantee) before it applies. Per-doctor discounts use users.discountNeedsApproval.
    // See docs/doctor-shares-plan.md §6.
    discountNeedsApproval: boolean("discount_needs_approval").notNull().default(false),
    // Per-clinic WhatsApp SENDER (Meta Cloud API). `whatsappPhoneNumberId` selects
    // which WABA number a message is sent FROM (so patients see the clinic's own
    // number); `whatsappDisplayNumber` (E.164) is for display + inbound routing.
    // NULL = not configured → falls back to the platform sender / graceful no-send.
    // `whatsappSignature` is the clinic-customisable footer fed into the template's
    // {{signature}} variable (no per-clinic Meta approval needed).
    // See docs/whatsapp-cloud-plan.md.
    whatsappPhoneNumberId: text("whatsapp_phone_number_id"),
    whatsappDisplayNumber: text("whatsapp_display_number"),
    whatsappSenderName: text("whatsapp_sender_name"),
    whatsappSignature: text("whatsapp_signature"),
    // ---- Super-admin control plane (docs/super-admin-plan.md §11 Migration A) ----
    // Lifecycle status. `active` = usable; a non-usable status blocks all the clinic's
    // staff from logging in (enforced server-side). Default `active` so existing clinics
    // stay usable; NEW clinics may be created as `trial`.
    status: text("status").notNull().default("active"), // trial|active|suspended|past_due|cancelled
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    suspendReason: text("suspend_reason"),
    // Owner / contact (CRM) + region. `timezone` drives availability/reminders per clinic.
    ownerName: text("owner_name"),
    ownerEmail: text("owner_email"),
    ownerPhone: text("owner_phone"),
    country: text("country"),
    city: text("city"),
    address: text("address"),
    timezone: text("timezone").notNull().default("Asia/Karachi"),
    region: text("region"), // intended data region (compliance)
    // Manual billing (clinic → Klenic). `paid_through` is pushed forward by payments;
    // owed/credit is derived (see core/admin/billing.ts). `capabilities` = the allowed
    // `resource:action` slugs for the whole clinic (NULL = all) — granular super-admin control.
    monthlyPrice: integer("monthly_price").notNull().default(0), // PKR
    billingCycle: text("billing_cycle").notNull().default("monthly"), // monthly|2m|quarter|half|annual
    graceDays: integer("grace_days").notNull().default(7),
    // Follow-up on an OUTSTANDING balance: when a clinic partly pays and commits to
    // pay the rest by a date, we save it here so the super admin knows when to chase.
    // Cleared automatically once the balance settles. (core/admin/billing.ts)
    paymentCommitmentAt: timestamp("payment_commitment_at", { withTimezone: true }),
    paymentCommitmentNote: text("payment_commitment_note"),
    capabilities: text("capabilities").array(), // NULL = all resource:action allowed
    // Account manager — the TEAM MEMBER (super-admin) who owns this clinic on our
    // side. NULL = unassigned. Drives "my clinics" + who to update on dues/follow-ups.
    // `AnyPgColumn` return type breaks the clinics⇄users circular type reference.
    assignedTo: uuid("assigned_to").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    notes: text("notes"), // internal CRM notes
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
    // Inbound WhatsApp routes by the receiving number → clinic. A phone_number_id
    // maps to exactly one clinic (unique when set); it's the routing lookup key.
    uniqueIndex("clinics_wa_phone_id_idx")
      .on(t.whatsappPhoneNumberId)
      .where(sql`${t.whatsappPhoneNumberId} is not null`),
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
    // Optional name prefix/title (e.g. Dr, Mr, Miss) — shown as "Dr. Bilal Aziz"
    // in the UI and patient messages. Free text from a fixed dropdown.
    prefix: text("prefix"),
    fullName: text("full_name"),
    // Storage key of the user's profile picture (core/integrations/storage), or
    // NULL. Served (self-only) via GET /api/me/avatar.
    avatarKey: text("avatar_key"),
    isActive: boolean("is_active").notNull().default(true),
    // Distinguishes the two inactive states for team members (both have
    // is_active=false): NULL = SUSPENDED (temporary, keeps their clinic
    // assignments); set = DEACTIVATED (their clinics were unassigned). Reactivating
    // clears it. (core/auth/admin-permissions.ts adminAccountState)
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
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
    // Doctor revenue share (percent 0-100) the clinic pays the doctor. `consultation`
    // = cut of the consultation fee; `procedure` = DEFAULT cut of procedures (a
    // per-procedure override in `doctor_procedure_shares` wins). See
    // docs/doctor-shares-plan.md.
    consultationSharePct: integer("consultation_share_pct").notNull().default(0),
    procedureSharePct: integer("procedure_share_pct").notNull().default(0),
    // When true, a discount taken from THIS doctor's share needs their approval
    // before it applies (the doctor's own policy; editable by them and the admin).
    discountNeedsApproval: boolean("discount_needs_approval").notNull().default(false),
    // ---- 2FA / TOTP (super-admin panel security; usable by any account) ----
    // `totpSecret` = base32 shared secret (present once enrolled); `totpEnabled` gates
    // the login TOTP challenge + step-up; `totpBackup` = SHA-256 hashes of one-time
    // backup codes. See core/auth/totp.ts + docs/super-admin-plan.md §11 Feature 1.
    totpSecret: text("totp_secret"),
    totpEnabled: boolean("totp_enabled").notNull().default(false),
    totpBackup: text("totp_backup").array(),
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
    // Super-admin support impersonation: when set, this session ACTS AS that clinic
    // (Feature 5). Never set for clinic staff. See docs/super-admin-plan.md §11.
    impersonatedClinicId: uuid("impersonated_clinic_id"),
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
 * `password_reset_tokens` — self-service password reset. Follows the `sessions` pattern
 * (keyed by user; no clinic_id, not soft-deleted): store the SHA-256 of an opaque token,
 * single-use (`used_at`), short expiry. Consuming one revokes the user's sessions.
 * See `core/auth/password-reset.ts`.
 */
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("password_reset_tokens_hash_unique").on(table.tokenHash),
    index("password_reset_tokens_user_idx").on(table.userId),
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
    // Consent to take/store clinical PHOTOS (gates `is_photo` attachments — §10).
    // Separate from data_consent; a photo can't be uploaded/shown without it.
    photoConsent: boolean("photo_consent").notNull().default(false),
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
    // Who absorbs the discount in the doctor/clinic revenue split: 'clinic'
    // (default), 'doctor', or 'split'. Drives core/appointments/shares.ts and the
    // approval workflow. Free-text (not an enum) to stay additive.
    discountBorneBy: text("discount_borne_by").notNull().default("clinic"),
    // Approval state of THIS appointment's discount (free-text, not an enum):
    //   'none'     — no discount, or none of the reduced parties require approval
    //                → the discount applies (this is the default, so behaviour is
    //                unchanged for clinics that don't opt in);
    //   'pending'  — required approver(s) haven't all signed off → discount is
    //                treated as 0 in the bill/sale/split until they do;
    //   'approved' — every required approver granted it → discount applies;
    //   'rejected' — a required approver declined → discount treated as 0 (staff
    //                re-submit by editing, which recomputes fresh pending rows).
    // Rows live in `appointment_discount_approvals`. See
    // core/appointments/approvals.ts and docs/doctor-shares-plan.md §6.
    discountStatus: text("discount_status").notNull().default("none"),
    // For a borne='split' discount, how much of it the DOCTOR side bears: 'percent'
    // = a % of the discount, 'amount' = a fixed PKR figure (shown as its equivalent
    // %). A fixed amount does NOT scale — `discount_split_stale` is set when the
    // discount later changes so staff re-enter it. Only meaningful when
    // discount_borne_by = 'split'. See docs/discount-bearing-plan.md.
    discountSplitType: text("discount_split_type").notNull().default("percent"),
    discountSplitValue: integer("discount_split_value").notNull().default(0),
    discountSplitStale: boolean("discount_split_stale").notNull().default(false),
    // Whether the doctor's consultation fee is charged for this visit. A patient
    // who comes only for a procedure has no consultation fee → set false and the
    // bill/sale count only the procedures. Default true (charge, as before).
    chargeConsultation: boolean("charge_consultation").notNull().default(true),
    // Denormalized cache of Σ collected against this appointment's bill (from
    // patient_payments; updated on every payment). Drives the appointment-list
    // Payment filter/badge without aggregating the ledger. Payment status is derived
    // vs the bill (computeBill): collected ≥ bill Paid · 0<collected<bill Partial ·
    // 0 Unpaid. See core/billing.
    amountCollected: integer("amount_collected").notNull().default(0),
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
 * Per-(doctor, procedure) revenue-share OVERRIDE (percent 0-100). A row = a
 * specific rate for that doctor on that procedure (a stored `0` means "0% — all to
 * the clinic", which is DIFFERENT from having no row → fall back to the doctor's
 * `procedure_share_pct` default). See docs/doctor-shares-plan.md.
 */
export const doctorProcedureShares = pgTable(
  "doctor_procedure_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    procedureId: uuid("procedure_id")
      .notNull()
      .references(() => procedures.id, { onDelete: "cascade" }),
    sharePct: integer("share_pct").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One override per doctor+procedure; also the lookup key for the resolver.
    uniqueIndex("doctor_procedure_shares_unique").on(t.doctorId, t.procedureId),
    index("doctor_procedure_shares_clinic_idx").on(t.clinicId),
  ],
);

/**
 * Discount approvals — one row per party (the clinic, and/or each affected doctor)
 * that must sign off on an appointment's discount before it applies. Rows are
 * (re)generated whenever the discount/borne-by changes (see
 * core/appointments/approvals.ts#syncDiscountApprovals); the appointment's overall
 * `discount_status` is derived from them. `approverKind` = 'clinic' | 'doctor';
 * a 'doctor' row names the affected doctor in `approverDoctorId` (they alone decide
 * it), while a 'clinic' row is decided by anyone holding the clinic's
 * discount-approval capability. `decidedBy`/`decidedByName` snapshot who acted.
 */
export const appointmentDiscountApprovals = pgTable(
  "appointment_discount_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    approverKind: text("approver_kind").notNull(), // 'clinic' | 'doctor'
    approverDoctorId: uuid("approver_doctor_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    status: text("status").notNull().default("pending"), // pending|approved|rejected
    // Who decided + a name snapshot (no FK on the id: users are soft-deleted).
    decidedBy: uuid("decided_by"),
    decidedByName: text("decided_by_name"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("appt_discount_approvals_appt_idx").on(t.appointmentId),
    // The clinic-approver queue scans "this clinic's pending clinic-borne rows".
    index("appt_discount_approvals_clinic_status_idx").on(t.clinicId, t.status),
    // The doctor queue scans "my pending rows".
    index("appt_discount_approvals_doctor_status_idx").on(
      t.approverDoctorId,
      t.status,
    ),
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
 * Per-doctor share ledger (doctor revenue-share feature). One row per DOCTOR who
 * earned a positive share on a COMPLETED appointment — a snapshot of what they're
 * owed, frozen at completion (via core/appointments/shares.ts#computeShare on the
 * approval-gated net) so later rate/discount edits never rewrite history. The
 * CLINIC's cut is derived (sale net − Σ these rows), so there is no clinic row here.
 * A multi-doctor visit produces several rows; recording replaces all rows for the
 * appointment. Payment is tracked as an amount-based running balance (Phase 7):
 * Earned = Σ share_amount, Paid = Σ doctor_payouts.amount, Outstanding = the
 * difference — there is no per-share paid flag. See docs/doctor-shares-plan.md §7-8,11.
 */

/**
 * Doctor payouts — one row per PAYMENT to a doctor against their accrued shares
 * (revenue-share, Phase 6-7). Amount-based running balance: a payment is an
 * ARBITRARY amount (partial allowed), validated ≤ the doctor's outstanding. The
 * balance is Σ sale_shares − Σ these amounts; deleting a payout (a correction)
 * simply raises the balance again. `amount`, who recorded it, and the (optional)
 * covered period are snapshots. `method`/`reference` record how it was paid. See
 * core/sales/payouts.ts.
 */
export const doctorPayouts = pgTable(
  "doctor_payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    doctorId: uuid("doctor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    doctorName: text("doctor_name"), // snapshot
    amount: integer("amount").notNull().default(0),
    method: text("method"), // e.g. 'cash' | 'bank' | 'other' (free-text)
    reference: text("reference"), // cheque/transaction no. etc.
    periodStart: date("period_start"), // optional; a period the payment covers
    periodEnd: date("period_end"),
    note: text("note"),
    createdBy: uuid("created_by"), // no FK — users are soft-deleted
    createdByName: text("created_by_name"), // snapshot
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("doctor_payouts_clinic_doctor_idx").on(t.clinicId, t.doctorId),
    index("doctor_payouts_clinic_created_idx").on(t.clinicId, t.createdAt),
  ],
);

export const saleShares = pgTable(
  "sale_shares",
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
    doctorName: text("doctor_name"), // snapshot (survives rename / soft-delete)
    shareAmount: integer("share_amount").notNull().default(0),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Replace-all-for-an-appointment + cascade cleanup.
    index("sale_shares_appointment_idx").on(t.appointmentId),
    // The report aggregates by clinic + date window.
    index("sale_shares_clinic_occurred_idx").on(t.clinicId, t.occurredAt),
    // "This doctor's earnings" (report + balance).
    index("sale_shares_clinic_doctor_idx").on(t.clinicId, t.doctorId),
  ],
);

/**
 * Discount settlements (doctor↔clinic bearing) — one snapshot row per PARTY per
 * completed appointment that carries an (effective) discount. Captures how the
 * discount is borne: the bearing party's balance moves by `settlement_amount`
 * (signed; negative = they bear a loss / a doctor may go into deficit), the
 * protected party is untouched. Accrual, computed at completion on the NET bill +
 * gross shares (NOT scaled by collection) — see docs/discount-bearing-plan.md §3.
 * Rewritten (replace-all-for-appointment) on the completion/edit/approval hooks,
 * exactly like `sale_shares`; a clinic row has `doctor_id` NULL.
 */
export const discountSettlements = pgTable(
  "discount_settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    party: text("party").notNull(), // 'clinic' | 'doctor'
    doctorId: uuid("doctor_id").references(() => users.id, {
      onDelete: "set null",
    }), // NULL for the clinic row
    doctorName: text("doctor_name"), // snapshot
    grossShare: integer("gross_share").notNull().default(0), // this party's pre-discount gross cut (reference)
    settlementAmount: integer("settlement_amount").notNull().default(0), // signed balance adjustment
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("discount_settlements_appointment_idx").on(t.appointmentId),
    index("discount_settlements_clinic_occurred_idx").on(t.clinicId, t.occurredAt),
    index("discount_settlements_clinic_doctor_idx").on(t.clinicId, t.doctorId),
  ],
);

/**
 * Doctor settlement actions — the manual money moves on a doctor's share balance:
 * a `doctor_waive` (doctor forgoes his own share, relieving the clinic), a
 * `clinic_waive` (clinic forgives a doctor's deficit — a clinic cost), a
 * `repayment` (doctor→clinic, settling a deficit from pocket), a `write_off`
 * (clinic writes a departed doctor's debt off), or a `reversal` (undo one of the
 * above, `reverses_id` → the reversed row). Amounts are positive PKR; the effect on
 * the balance comes from `kind`. `line_ref` scopes a waive to one earning line (a
 * procedure id, or 'consultation'); NULL = the whole visit. Audit-logged; clinic-
 * side kinds need the `share_waive` permission (a doctor waives his own by identity).
 */
export const doctorSettlementActions = pgTable(
  "doctor_settlement_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    doctorId: uuid("doctor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    doctorName: text("doctor_name"), // snapshot
    // The visit the action relates to (NULL for a standalone repayment/write-off).
    appointmentId: uuid("appointment_id").references(() => appointments.id, {
      onDelete: "set null",
    }),
    lineRef: text("line_ref"), // procedure id | 'consultation' | NULL (whole visit)
    kind: text("kind").notNull(), // doctor_waive | clinic_waive | repayment | write_off | reversal
    amount: integer("amount").notNull().default(0), // positive PKR; meaning by kind
    reversesId: uuid("reverses_id"), // self-ref (no FK); the row a reversal undoes
    note: text("note"),
    createdBy: uuid("created_by"),
    createdByName: text("created_by_name"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("doctor_settlement_actions_clinic_doctor_idx").on(t.clinicId, t.doctorId),
    index("doctor_settlement_actions_clinic_occurred_idx").on(t.clinicId, t.occurredAt),
    index("doctor_settlement_actions_appointment_idx").on(t.appointmentId),
    // At most ONE per-line doctor_waive per (appointment, line) — makes a double-waive
    // race impossible at the DB level (a duplicate insert 23505s). Only per-line waives
    // (line_ref set) are constrained; amount-based waives (line_ref NULL) are not.
    uniqueIndex("doctor_settlement_actions_line_waive_uniq")
      .on(t.appointmentId, t.lineRef)
      .where(sql`${t.kind} = 'doctor_waive' and ${t.lineRef} is not null and ${t.appointmentId} is not null`),
  ],
);

/**
 * Patient payments ledger (Finance — patient billing). Every money movement on a
 * patient's account: a `payment` against a visit's bill, an `advance` (prepaid
 * credit — `appointment_id` NULL), an `advance_applied` (credit consumed by a
 * bill), or a `refund`. Amounts are positive PKR; the sign/meaning comes from
 * `kind`. Collected on a visit = Σ(payment + advance_applied) for that
 * appointment; patient credit = Σadvance − Σadvance_applied − Σrefund. Soft-
 * deletable (a void is a soft delete, linked via `reverses_id`). See core/billing.
 */
export const patientPayments = pgTable(
  "patient_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    // NULL = an unallocated advance (patient-level credit, not tied to a visit).
    appointmentId: uuid("appointment_id").references(() => appointments.id, {
      onDelete: "set null",
    }),
    kind: text("kind").notNull(), // payment | advance | advance_applied | refund
    amount: integer("amount").notNull().default(0),
    method: text("method"), // cash | bank | cheque | other
    reference: text("reference"),
    note: text("note"),
    // The entry a refund/void reverses (traceability); no FK (self-ref, soft-del).
    reversesId: uuid("reverses_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by"),
    createdByName: text("created_by_name"),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("patient_payments_clinic_patient_idx").on(t.clinicId, t.patientId),
    index("patient_payments_appointment_idx").on(t.appointmentId),
    index("patient_payments_clinic_occurred_idx").on(t.clinicId, t.occurredAt),
    index("patient_payments_deleted_idx")
      .on(t.clinicId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

/**
 * `clinic_payments` — the CLINIC → Klenic subscription ledger (manual billing, v1).
 * Mirrors `patient_payments`: each row is a payment RECEIVED from a clinic, covering
 * `months_covered` months, which pushes the clinic's derived `paid_through` forward
 * (unpaid time carries forward as a running balance). Super-admin only. Soft-deletable
 * (a void). See core/admin/billing.ts + docs/super-admin-plan.md §5.1/§11 Feature 6.
 */
export const clinicPayments = pgTable(
  "clinic_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull().default(0), // PKR (always positive; sign from kind)
    // 'payment' = money IN from the clinic (+balance, +cash revenue); 'refund' =
    // money OUT to the clinic (−balance, −cash revenue); 'credit' = non-cash account
    // credit / goodwill (+balance, NOT cash revenue). See core/admin/billing.ts.
    kind: text("kind").notNull().default("payment"),
    method: text("method"), // bank | cash | cheque | other
    reference: text("reference"),
    monthsCovered: integer("months_covered").notNull().default(1), // pushes paid_through
    note: text("note"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    recordedBy: uuid("recorded_by"),
    recordedByName: text("recorded_by_name"),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("clinic_payments_clinic_occurred_idx").on(t.clinicId, t.occurredAt),
    index("clinic_payments_deleted_idx")
      .on(t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

/**
 * Platform cost rates (Owner Finance — the COMPANY's serving-cost config). NOT a
 * tenant table (no `clinic_id`): these are Klenic's own unit costs for the metered
 * dependencies. Every rate change inserts a NEW row (history) with `effectiveFrom`
 * — the latest row is the current rate; past periods can later be costed at the
 * rate that was live then. Unit costs are stored in `currency` (USD by default) as
 * decimals; `usdToPkr` converts to the PKR the rest of the app shows. v1 is a
 * count×rate estimate (scribe calls from `visits`, WhatsApp from `whatsapp_messages`)
 * — precise token/minute metering is a later add. See core/admin/cost.ts.
 */
export const platformCostRates = pgTable(
  "platform_cost_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // ESTIMATE rates (count × rate) — a flat cost per scribe call (fallback for a
    // visit with no metered usage) and per WhatsApp message, in `currency`.
    scribeCallCost: numeric("scribe_call_cost", { precision: 12, scale: 6 }).notNull().default("0"),
    whatsappMsgCost: numeric("whatsapp_msg_cost", { precision: 12, scale: 6 }).notNull().default("0"),
    // METERED rates (accurate) — Whisper per audio MINUTE, Claude per 1M input /
    // output TOKENS. Used when a scribe call logs real usage (see ai_usage). USD.
    whisperMinuteCost: numeric("whisper_minute_cost", { precision: 12, scale: 6 }).notNull().default("0"),
    claudeInputCost: numeric("claude_input_cost", { precision: 12, scale: 6 }).notNull().default("0"),
    claudeOutputCost: numeric("claude_output_cost", { precision: 12, scale: 6 }).notNull().default("0"),
    currency: text("currency").notNull().default("USD"),
    usdToPkr: numeric("usd_to_pkr", { precision: 12, scale: 4 }).notNull().default("0"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("platform_cost_rates_effective_idx").on(t.effectiveFrom)],
);

/**
 * AI usage meter (Owner Finance — precise serving cost). One row per PAID AI call in
 * a scribe run: a `whisper` row (audio seconds) + a `claude` row (input/output
 * tokens). `cost_pkr` is SNAPSHOTTED at the rates live when recorded (so a later rate
 * change never rewrites history), computed by `core/ai/usage.ts` from
 * `platform_cost_rates`. Lets `computeServingCost` use metered cost instead of the
 * flat per-call estimate. Carries `clinic_id` (cross-tenant reads run `unscoped`).
 */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    visitId: uuid("visit_id").references(() => visits.id, { onDelete: "set null" }),
    provider: text("provider").notNull(), // 'whisper' | 'claude'
    model: text("model"),
    audioSeconds: integer("audio_seconds").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costPkr: integer("cost_pkr").notNull().default(0), // snapshot at record-time rates
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_usage_clinic_occurred_idx").on(t.clinicId, t.occurredAt),
    index("ai_usage_occurred_idx").on(t.occurredAt),
    index("ai_usage_visit_idx").on(t.visitId),
  ],
);

/**
 * Company expense categories (Owner Finance — the COMPANY's opex). Klenic's own
 * cost buckets (Payroll, Rent, …). NOT a tenant table (no `clinic_id`). Deactivate
 * with `is_active` (kept for history). See core/admin/company-expenses.ts.
 */
export const companyExpenseCategories = pgTable("company_expense_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Company expenses (Owner Finance — the COMPANY's operating costs: payroll, rent,
 * software, marketing, …). Feeds the company P&L (net profit = collected revenue −
 * serving cost − these). NOT a tenant table (no `clinic_id` — it's Klenic's own
 * cost, so the tenant guard ignores it). Soft-deletable (recoverable); `recurring`
 * tags a repeating cost the cron materialises each period (reusing the clinic
 * recurring date math). ACL + audit live in the action layer.
 */
export const companyExpenses = pgTable(
  "company_expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    categoryId: uuid("category_id").references(() => companyExpenseCategories.id, {
      onDelete: "set null",
    }),
    amount: integer("amount").notNull().default(0), // PKR
    incurredOn: date("incurred_on").notNull(),
    vendor: text("vendor"),
    method: text("method"), // cash | bank | cheque | other
    reference: text("reference"),
    note: text("note"),
    recurring: boolean("recurring").notNull().default(false),
    recurrence: text("recurrence"), // 'monthly' | 'weekly' when recurring
    nextRunOn: date("next_run_on"),
    createdBy: uuid("created_by"),
    createdByName: text("created_by_name"),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("company_expenses_incurred_idx").on(t.incurredOn),
    index("company_expenses_category_idx").on(t.categoryId),
    index("company_expenses_deleted_idx")
      .on(t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
    index("company_expenses_recurring_due_idx")
      .on(t.nextRunOn)
      .where(sql`${t.recurring} = true and ${t.deletedAt} is null`),
  ],
);

/**
 * Company settings (Owner Finance) — a SINGLETON config row for Klenic itself (not
 * a tenant). Holds the company-global subscription-invoice counter + prefix (Klenic
 * issues one numbered sequence across all clinics). Seeded lazily. See
 * core/admin/clinic-invoices.ts.
 */
export const companySettings = pgTable("company_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  nextInvoiceNo: integer("next_invoice_no").notNull().default(1),
  invoicePrefix: text("invoice_prefix").notNull().default("KL-INV-"),
  // Company-wide default for the Owner Overview churn threshold: a live clinic quiet
  // for ≥ this many days is "at risk". The Overview dropdown overrides it per-view.
  churnInactiveDays: integer("churn_inactive_days").notNull().default(21),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Clinic subscription invoices (Owner Finance, Phase 4) — invoices/receipts KLENIC
 * issues TO a clinic for its subscription (distinct from patient `invoices`).
 * `invoice_no` is a company-global sequence (allocated by locking `company_settings`
 * and bumping `next_invoice_no`), shown with its prefix. `amount` is stored (the
 * agreed charge for the period — usually the clinic's monthly_price). Soft-deletable
 * (a void keeps the number). Cross-tenant super-admin reads → `unscoped`.
 */
export const clinicInvoices = pgTable(
  "clinic_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    invoiceNo: integer("invoice_no").notNull(),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    amount: integer("amount").notNull().default(0), // PKR
    note: text("note"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    issuedBy: uuid("issued_by"),
    issuedByName: text("issued_by_name"),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("clinic_invoices_no_unique").on(t.invoiceNo),
    index("clinic_invoices_clinic_idx").on(t.clinicId),
    index("clinic_invoices_issued_idx").on(t.issuedAt),
    index("clinic_invoices_deleted_idx")
      .on(t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

/**
 * Invoices (Finance — patient billing). One per completed appointment. The bill
 * amount is derived live from `computeBill` (not stored), so a later edit flows
 * through; the invoice just records that a numbered document was issued.
 * `invoiceNo` is a per-clinic sequential integer (allocated by atomically bumping
 * `clinics.next_invoice_no`), shown with `clinics.invoice_prefix`. Soft-deletable
 * (a void keeps the number). See core/billing.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    invoiceNo: integer("invoice_no").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    issuedBy: uuid("issued_by"),
    issuedByName: text("issued_by_name"),
    note: text("note"),
    ...softDeleteColumns(),
  },
  (t) => [
    // One live invoice per appointment (soft-deleted ones don't block a re-issue).
    uniqueIndex("invoices_appointment_unique")
      .on(t.appointmentId)
      .where(sql`${t.deletedAt} is null`),
    uniqueIndex("invoices_clinic_no_unique").on(t.clinicId, t.invoiceNo),
    index("invoices_clinic_issued_idx").on(t.clinicId, t.issuedAt),
    index("invoices_patient_idx").on(t.patientId),
  ],
);

/**
 * Expense categories (Finance) — a clinic's editable list (Rent, Salaries, …). Not
 * soft-deleted; deactivate with `is_active` (kept for history on past expenses).
 */
export const expenseCategories = pgTable(
  "expense_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("expense_categories_clinic_idx").on(t.clinicId, t.isActive)],
);

/**
 * Expenses (Finance) — the clinic's costs (rent, salaries, supplies, lab, …). Feeds
 * the P&L (net profit = collected revenue − doctor shares − expenses). Soft-
 * deletable (recoverable). `recurring` tags a repeating cost (drives "duplicate" and
 * a future cron). See core/expenses. Gated by the `finance` feature.
 */
export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => expenseCategories.id, {
      onDelete: "set null",
    }),
    amount: integer("amount").notNull().default(0),
    incurredOn: date("incurred_on").notNull(),
    vendor: text("vendor"),
    method: text("method"), // cash | bank | cheque | other
    reference: text("reference"),
    note: text("note"),
    recurring: boolean("recurring").notNull().default(false),
    // When `recurring`, the repeat interval ('monthly' | 'weekly') and the next date
    // the cron should materialise a fresh (non-recurring) copy of this expense.
    // NULL on a one-off expense and on a generated copy. See core/expenses/recurring.ts.
    recurrence: text("recurrence"),
    nextRunOn: date("next_run_on"),
    createdBy: uuid("created_by"),
    createdByName: text("created_by_name"),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("expenses_clinic_incurred_idx").on(t.clinicId, t.incurredOn),
    index("expenses_clinic_category_idx").on(t.clinicId, t.categoryId),
    index("expenses_deleted_idx")
      .on(t.clinicId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
    // The recurring-expense cron scans due templates across all clinics.
    index("expenses_recurring_due_idx")
      .on(t.nextRunOn)
      .where(sql`${t.recurring} = true and ${t.deletedAt} is null`),
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
    // The PERFORMING doctor for this line (revenue share goes to them). NULL =
    // falls back to the appointment's consulting doctor. See docs/doctor-shares-plan.md.
    doctorId: uuid("doctor_id").references(() => users.id, { onDelete: "set null" }),
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

/**
 * `notifications` — CORE, specialty-agnostic per-user in-app alerts (the bell). One
 * ROW per recipient (fan-out = many rows). TRANSIENT like `activity_logs`/`sessions`:
 * NOT soft-deleted and NOT in Trash; "dismiss" = mark read, old read rows pruned by an
 * optional cron. `type`/`entity` are free-text tags (never enums) so specialties add
 * none. Reads are self-scoped (`user_id = self`) AND clinic-scoped. See
 * `core/notifications/in-app.ts` + docs/notifications-plan.md.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // NULL only for super-admin/platform notifications (v2); clinic staff rows are set.
    clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // free-text, e.g. discount.approval_needed | whatsapp.inbound
    title: text("title").notNull(),
    body: text("body"),
    entity: text("entity"), // appointment | patient | discount | payout | …
    entityId: uuid("entity_id"),
    link: text("link"), // precomputed in-app URL for the bell to navigate to
    // Who triggered it — snapshot (no FK; actors soft-delete). NULL for system events.
    actorUserId: uuid("actor_user_id"),
    actorName: text("actor_name"),
    readAt: timestamp("read_at", { withTimezone: true }), // NULL = unread (source of truth)
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Unread count: a partial index so COUNT(*) for a user's unread is O(index).
    index("notifications_user_unread_idx")
      .on(t.userId)
      .where(sql`${t.readAt} is null`),
    // The bell list: a user's notifications, newest first.
    index("notifications_user_created_idx").on(t.userId, t.createdAt),
    // Tenant scans + prune.
    index("notifications_clinic_idx").on(t.clinicId),
  ],
);

/**
 * `patient_medical_history` — CORE, specialty-agnostic (every specialty needs it).
 * 1:1 with a patient; the LATEST snapshot (the audit log covers who changed what).
 * Gates the drug formulary: prescribing a drug that matches a recorded allergy warns.
 * Types + the allergy gate live in `core/lib/medical-history.ts`.
 */
export const patientMedicalHistory = pgTable(
  "patient_medical_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    allergies: jsonb("allergies").$type<Allergy[]>().notNull().default([]),
    conditions: jsonb("conditions").$type<string[]>().notNull().default([]),
    medications: jsonb("medications").$type<Medication[]>().notNull().default([]),
    smoking: text("smoking"),
    alcohol: text("alcohol"),
    notes: text("notes"),
    updatedBy: uuid("updated_by"),
    updatedByName: text("updated_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("patient_medical_history_patient_uq").on(t.patientId),
    index("patient_medical_history_clinic_idx").on(t.clinicId),
  ],
);

/**
 * `clinical_attachments` — CORE imaging/photos/docs/consent (specialty-agnostic;
 * derma/hair reuse it for before/after photos). Bytes live in clinic-scoped storage
 * (`saveClinicFile(clinicId, "clinical", …)`), served by the authorized route
 * `GET /api/clinical/attachment/[id]`. `is_photo` drives the photo-consent gate.
 */
export const clinicalAttachments = pgTable(
  "clinical_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    visitId: uuid("visit_id").references(() => visits.id, { onDelete: "set null" }),
    kind: text("kind").notNull(), // xray | photo | document | consent
    storageKey: text("storage_key").notNull(),
    mime: text("mime"),
    caption: text("caption"),
    takenAt: timestamp("taken_at", { withTimezone: true }),
    isPhoto: boolean("is_photo").notNull().default(false),
    uploadedBy: uuid("uploaded_by"),
    uploadedByName: text("uploaded_by_name"),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("clinical_attachments_patient_idx").on(t.clinicId, t.patientId),
    index("clinical_attachments_visit_idx").on(t.visitId),
    index("clinical_attachments_deleted_idx")
      .on(t.clinicId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

/**
 * `treatment_plans` — CORE (specialty-agnostic): a multi-visit, priced course of
 * treatment for a patient. `module` is a free-text tag. Derma/hair reuse this for
 * their own courses. Soft-deletable.
 */
export const treatmentPlans = pgTable(
  "treatment_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    module: text("module").notNull().default(""),
    title: text("title").notNull(),
    status: text("status").notNull().default("proposed"), // proposed|active|completed|cancelled
    note: text("note"),
    createdBy: uuid("created_by"),
    createdByName: text("created_by_name"),
    ...softDeleteColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("treatment_plans_patient_idx").on(t.clinicId, t.patientId),
    index("treatment_plans_deleted_idx")
      .on(t.clinicId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

/**
 * `treatment_plan_items` — the planned procedures. `name`/`unit_price` are SNAPSHOTS
 * (like appointment_procedures) so catalog edits never rewrite a plan. `tooth` is
 * FDI (dental fills it; others leave null). Scheduling an item links it to an
 * appointment and mints an `appointment_procedures` line, so plans feed Sales via
 * the SAME money path.
 */
export const treatmentPlanItems = pgTable(
  "treatment_plan_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => treatmentPlans.id, { onDelete: "cascade" }),
    procedureId: uuid("procedure_id").references(() => procedures.id, { onDelete: "set null" }),
    name: text("name").notNull(), // snapshot
    unitPrice: integer("unit_price").notNull().default(0), // snapshot, PKR
    tooth: text("tooth"), // FDI, nullable
    quantity: integer("quantity").notNull().default(1),
    status: text("status").notNull().default("planned"), // planned|in_progress|done|cancelled
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("treatment_plan_items_plan_idx").on(t.planId),
    index("treatment_plan_items_clinic_idx").on(t.clinicId),
    index("treatment_plan_items_appt_idx").on(t.appointmentId),
  ],
);

/**
 * `announcements` — super-admin → clinic notices (Feature 10). `clinic_id` NULL =
 * broadcast to ALL clinics; else targeted to one. Shown in the clinic notice bar
 * while `active` and within the optional starts_at/ends_at window. Platform data
 * (super-admin's own content), not tenant clinical data — hard-deletable.
 */
export const announcements = pgTable(
  "announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id").references(() => clinics.id, { onDelete: "cascade" }), // NULL = all
    level: text("level").notNull().default("info"), // info | warning
    title: text("title").notNull(),
    body: text("body").notNull(),
    active: boolean("active").notNull().default(true),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("announcements_clinic_idx").on(t.clinicId),
    index("announcements_active_idx").on(t.active),
  ],
);

// Inferred row types for use across the app.
export type Clinic = typeof clinics.$inferSelect;
export type PatientMedicalHistory = typeof patientMedicalHistory.$inferSelect;
export type ClinicalAttachment = typeof clinicalAttachments.$inferSelect;
export type TreatmentPlan = typeof treatmentPlans.$inferSelect;
export type TreatmentPlanItem = typeof treatmentPlanItems.$inferSelect;
export type ActivityLog = typeof activityLogs.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type ClinicPayment = typeof clinicPayments.$inferSelect;
export type PlatformCostRate = typeof platformCostRates.$inferSelect;
export type AiUsage = typeof aiUsage.$inferSelect;
export type CompanyExpense = typeof companyExpenses.$inferSelect;
export type CompanyExpenseCategory = typeof companyExpenseCategories.$inferSelect;
export type CompanySettings = typeof companySettings.$inferSelect;
export type ClinicInvoice = typeof clinicInvoices.$inferSelect;
export type Announcement = typeof announcements.$inferSelect;
export type Procedure = typeof procedures.$inferSelect;
export type DoctorProcedureShare = typeof doctorProcedureShares.$inferSelect;
export type AppointmentDiscountApproval =
  typeof appointmentDiscountApprovals.$inferSelect;
export type AppointmentProcedure = typeof appointmentProcedures.$inferSelect;
export type Sale = typeof sales.$inferSelect;
export type SaleShare = typeof saleShares.$inferSelect;
export type DiscountSettlement = typeof discountSettlements.$inferSelect;
export type DoctorSettlementAction = typeof doctorSettlementActions.$inferSelect;
export type DoctorPayout = typeof doctorPayouts.$inferSelect;
export type PatientPayment = typeof patientPayments.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type ExpenseCategory = typeof expenseCategories.$inferSelect;
export type Expense = typeof expenses.$inferSelect;
export type DoctorLeave = typeof doctorLeaves.$inferSelect;
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Patient = typeof patients.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type Visit = typeof visits.$inferSelect;
export type Recall = typeof recalls.$inferSelect;
export type WhatsappMessage = typeof whatsappMessages.$inferSelect;
