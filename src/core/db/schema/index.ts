/**
 * Drizzle schema — the single source of truth for the database structure.
 * Migrations are GENERATED from it (`npm run db:generate`). Never hand-edit the
 * database; change the schema and generate a migration.
 *
 * CORE, specialty-agnostic. Only shared platform tables live here. Specialty data
 * (e.g. a dental tooth chart) lives in module-owned tables — `modules/<id>/db/schema.ts`
 * — and never as columns on these (CLAUDE.md §5).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS IS A BARREL. Import from `@/core/db/schema` and nothing changes.
 * ─────────────────────────────────────────────────────────────────────────
 * The schema was one 1,977-line file with 156 importers — the highest-fan-in module
 * in the codebase, so every table change invalidated the widest possible surface and
 * reviews got harder with each migration (delta D-09). It is now split by DOMAIN, and
 * this barrel keeps every existing import working untouched:
 *
 *   _shared     the soft-delete columns every deletable table spreads
 *   identity    tenants and people — clinics, users, sessions, patients
 *   scheduling  appointments, doctor leave, recalls
 *   clinical    visits (the AI note), medical history, attachments, treatment plans
 *   billing     the priced catalog, line items, revenue ledgers, payments, invoices
 *   messaging   the WhatsApp log and in-app notifications
 *   platform    audit trail, imports, announcements, and FlexicaAI's own books
 *
 * WHY THOSE BOUNDARIES: they follow the FOREIGN KEYS, not a filing instinct. Files
 * must form a DAG — a cycle between two schema modules breaks at import time. That
 * is why `clinics` and `users` share a file (they reference each other) and why
 * `patients` sits with them rather than in `clinical`: scheduling and clinical both
 * depend on patients, and neither may depend on the other.
 *
 * `drizzle.config.ts` globs `./src/core/db/schema/*.ts`, so a new domain file is
 * picked up automatically — but it must also be re-exported here, or the tenant
 * guard (which discovers tenant tables by walking THIS module's exports) will not
 * see its tables and will stop guarding them.
 */

export * from "@/core/db/schema/_shared";
export * from "@/core/db/schema/identity";
export * from "@/core/db/schema/scheduling";
export * from "@/core/db/schema/clinical";
export * from "@/core/db/schema/billing";
export * from "@/core/db/schema/messaging";
export * from "@/core/db/schema/platform";
