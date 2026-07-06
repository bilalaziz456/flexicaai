import {
  boolean,
  index,
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

/**
 * Tenants. `modulesEnabled` is the array the specialty checkboxes read/write —
 * e.g. ['dental']. Core code checks this list but never hardcodes a specialty.
 */
export const clinics = pgTable("clinics", {
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
});

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
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRole("role").notNull(),
    fullName: text("full_name"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Emails are stored lowercased; enforce global uniqueness.
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

// Inferred row types for use across the app.
export type Clinic = typeof clinics.$inferSelect;
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
