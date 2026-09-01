-- The seven ENUM-backed vocabularies become reference tables, and their columns
-- become integer foreign keys (owner's direction, 2026-09-02). Completes ADR-027 over
-- the remaining vocabularies.
--
-- WHAT THIS BUYS, and what it does not: Postgres already refused a value outside an
-- enum, so the FK adds no integrity here. It adds a ROW per value — which is what lets
-- a label be renamed, a dropdown reordered, or a value retired without a deploy
-- (core/db/vocabulary-cache.ts reads those from here at start-up).
--
-- drizzle-kit CANNOT generate this conversion. Three things it emits would fail or be
-- silently wrong, and all three are corrected below:
--   1. SET DATA TYPE integer with no USING clause — Postgres will not cast an enum to
--      an integer implicitly. Each column carries an explicit USING that looks its
--      code up in the new table, so every existing row keeps its meaning.
--   2. The existing DEFAULT must be DROPPED first; a text default cannot survive the
--      type change and blocks the ALTER.
--   3. SET DEFAULT 'scheduled' on an integer column — drizzle-kit does not run a
--      custom type's toDriver when generating DDL, so the ids are written out here.
--
-- The old enum TYPES are deliberately left in place: nothing references them once the
-- columns are converted, and keeping them keeps this migration reversible.
--> statement-breakpoint
CREATE TABLE "appointment_statuses" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "appointment_statuses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "recall_statuses" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "recall_statuses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "theme_preferences" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "theme_preferences_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "user_roles_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "visit_statuses" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "visit_statuses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_directions" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "whatsapp_directions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_statuses" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "whatsapp_statuses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
-- Seed: explicit ids, mirrored in src/core/db/vocabulary-seed.ts
--> statement-breakpoint
INSERT INTO "appointment_statuses" ("id", "code", "label", "sort_order") VALUES
  (1, 'scheduled', 'Scheduled', 1),
  (2, 'confirmed', 'Confirmed', 2),
  (3, 'arrived', 'Arrived', 3),
  (4, 'in_progress', 'In progress', 4),
  (5, 'completed', 'Completed', 5),
  (6, 'cancelled', 'Cancelled', 6),
  (7, 'no_show', 'No-show', 7)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "visit_statuses" ("id", "code", "label", "sort_order") VALUES
  (1, 'transcribing', 'Transcribing', 1),
  (2, 'draft', 'Draft', 2),
  (3, 'approved', 'Approved', 3),
  (4, 'failed', 'Failed', 4)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "recall_statuses" ("id", "code", "label", "sort_order") VALUES
  (1, 'pending', 'Pending', 1),
  (2, 'scheduled', 'Scheduled', 2),
  (3, 'sent', 'Sent', 3),
  (4, 'booked', 'Booked', 4),
  (5, 'completed', 'Completed', 5),
  (6, 'cancelled', 'Cancelled', 6)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "user_roles" ("id", "code", "label", "sort_order") VALUES
  (1, 'super_admin', 'Super admin', 1),
  (2, 'clinic_admin', 'Clinic admin', 2),
  (3, 'manager', 'Manager', 3),
  (4, 'doctor', 'Doctor', 4),
  (5, 'receptionist', 'Receptionist', 5)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "theme_preferences" ("id", "code", "label", "sort_order") VALUES
  (1, 'system', 'System', 1),
  (2, 'light', 'Light', 2),
  (3, 'dark', 'Dark', 3)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "whatsapp_directions" ("id", "code", "label", "sort_order") VALUES
  (1, 'inbound', 'Inbound', 1),
  (2, 'outbound', 'Outbound', 2)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "whatsapp_statuses" ("id", "code", "label", "sort_order") VALUES
  (1, 'queued', 'Queued', 1),
  (2, 'sent', 'Sent', 2),
  (3, 'delivered', 'Delivered', 3),
  (4, 'read', 'Read', 4),
  (5, 'failed', 'Failed', 5),
  (6, 'received', 'Received', 6)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- Convert each column, preserving every row's meaning.
--
-- The USING clause is a literal CASE, not a lookup: Postgres refuses a SUBQUERY in a
-- transform expression ("cannot use subquery in transform expression"), so the ids are
-- spelled out — which matches the rule that they are written down rather than derived.
-- A value the CASE does not cover yields NULL and the column's NOT NULL then FAILS the
-- migration, rather than quietly blanking a status.
--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "status" SET DATA TYPE integer USING (
  CASE "status"::text
    WHEN 'scheduled' THEN 1
    WHEN 'confirmed' THEN 2
    WHEN 'arrived' THEN 3
    WHEN 'in_progress' THEN 4
    WHEN 'completed' THEN 5
    WHEN 'cancelled' THEN 6
    WHEN 'no_show' THEN 7
  END
);
--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "status" SET DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "visits" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "visits" ALTER COLUMN "status" SET DATA TYPE integer USING (
  CASE "status"::text
    WHEN 'transcribing' THEN 1
    WHEN 'draft' THEN 2
    WHEN 'approved' THEN 3
    WHEN 'failed' THEN 4
  END
);
--> statement-breakpoint
ALTER TABLE "visits" ALTER COLUMN "status" SET DEFAULT 2;
--> statement-breakpoint
ALTER TABLE "recalls" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "recalls" ALTER COLUMN "status" SET DATA TYPE integer USING (
  CASE "status"::text
    WHEN 'pending' THEN 1
    WHEN 'scheduled' THEN 2
    WHEN 'sent' THEN 3
    WHEN 'booked' THEN 4
    WHEN 'completed' THEN 5
    WHEN 'cancelled' THEN 6
  END
);
--> statement-breakpoint
ALTER TABLE "recalls" ALTER COLUMN "status" SET DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE integer USING (
  CASE "role"::text
    WHEN 'super_admin' THEN 1
    WHEN 'clinic_admin' THEN 2
    WHEN 'manager' THEN 3
    WHEN 'doctor' THEN 4
    WHEN 'receptionist' THEN 5
  END
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "theme" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "theme" SET DATA TYPE integer USING (
  CASE "theme"::text
    WHEN 'system' THEN 1
    WHEN 'light' THEN 2
    WHEN 'dark' THEN 3
  END
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "theme" SET DEFAULT 1;
--> statement-breakpoint
-- Dropped first: this partial index's predicate compares to the ENUM literal
-- (`direction = 'inbound'::whatsapp_direction`, migration 0079), so the type change
-- fails with "operator does not exist: integer = whatsapp_direction" while it stands.
-- Recreated against the id at the end of this migration.
DROP INDEX IF EXISTS "wa_messages_inbound_external_id_unique";
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ALTER COLUMN "direction" SET DATA TYPE integer USING (
  CASE "direction"::text
    WHEN 'inbound' THEN 1
    WHEN 'outbound' THEN 2
  END
);
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ALTER COLUMN "status" SET DATA TYPE integer USING (
  CASE "status"::text
    WHEN 'queued' THEN 1
    WHEN 'sent' THEN 2
    WHEN 'delivered' THEN 3
    WHEN 'read' THEN 4
    WHEN 'failed' THEN 5
    WHEN 'received' THEN 6
  END
);
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ALTER COLUMN "status" SET DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_status_visit_statuses_id_fk" FOREIGN KEY ("status") REFERENCES "public"."visit_statuses"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_user_roles_id_fk" FOREIGN KEY ("role") REFERENCES "public"."user_roles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_theme_theme_preferences_id_fk" FOREIGN KEY ("theme") REFERENCES "public"."theme_preferences"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_status_appointment_statuses_id_fk" FOREIGN KEY ("status") REFERENCES "public"."appointment_statuses"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recalls" ADD CONSTRAINT "recalls_status_recall_statuses_id_fk" FOREIGN KEY ("status") REFERENCES "public"."recall_statuses"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_direction_whatsapp_directions_id_fk" FOREIGN KEY ("direction") REFERENCES "public"."whatsapp_directions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_status_whatsapp_statuses_id_fk" FOREIGN KEY ("status") REFERENCES "public"."whatsapp_statuses"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "wa_messages_inbound_external_id_unique" ON "whatsapp_messages" USING btree ("external_id") WHERE "external_id" is not null and "direction" = 1;
