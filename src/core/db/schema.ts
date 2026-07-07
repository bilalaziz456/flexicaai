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
    // UI theme preference; "system" follows the OS.
    theme: themePreference("theme").notNull().default("system"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Username is the login credential — globally unique, stored lowercased.
    uniqueIndex("users_username_unique").on(table.username),
    // Email is optional; unique when present (Postgres treats NULLs as distinct).
    uniqueIndex("users_email_unique").on(table.email),
    // Multi-tenant lookups filter by clinic_id constantly — index it.
    index("users_clinic_id_idx").on(table.clinicId),
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
    // Consent for data use (CLAUDE.md §10). Photo consent added by modules that need it.
    dataConsent: boolean("data_consent").notNull().default(false),
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
    // Module-shaped structured note.
    note: jsonb("note").$type<Record<string, unknown>>(),
    visitDate: timestamp("visit_date", { withTimezone: true })
      .notNull()
      .defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
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
  ],
);

// Inferred row types for use across the app.
export type Clinic = typeof clinics.$inferSelect;
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Patient = typeof patients.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type Visit = typeof visits.$inferSelect;
export type Recall = typeof recalls.$inferSelect;
