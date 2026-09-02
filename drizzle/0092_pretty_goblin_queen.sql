-- The last twelve free-text vocabularies become reference tables, and the thirteen
-- columns carrying them become integer foreign keys (owner's direction, 2026-09-02).
-- Completes ADR-027: there are now no closed vocabularies left as loose text.
--
-- These are the ones the FK helps MOST and which came last anyway. They had nothing
-- guarding them — no enum, no CHECK — so unlike migration 0090 this is genuine new
-- integrity; and unlike 0087 a bad value's worst case was a wrong badge or paper size
-- rather than a wrong money figure, which is why they were not urgent.
--
-- Same three drizzle-kit corrections as 0090, for the same reasons: the USING clause it
-- omits (a text column will not cast to integer implicitly), the DEFAULT that must be
-- dropped before the type change, and the code-string defaults it writes onto integer
-- columns. The USING is a literal CASE — a value it does not cover yields NULL, and a
-- NOT NULL column then fails the migration rather than silently blanking a status.
--
-- NULLABLE columns are deliberate: both `recurrence` columns and `ai_usage.provider`
-- keep their nullability, so "not recurring" stays representable.
--> statement-breakpoint
CREATE TABLE "ai_providers" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "ai_providers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "announcement_levels" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "announcement_levels_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "appointment_sources" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "appointment_sources_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "attachment_kinds" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "attachment_kinds_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "billing_cycles" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "billing_cycles_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "clinic_statuses" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "clinic_statuses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "import_batch_statuses" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "import_batch_statuses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "invoice_papers" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "invoice_papers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "recurrences" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "recurrences_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "tax_modes" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "tax_modes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "treatment_item_statuses" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "treatment_item_statuses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "treatment_plan_statuses" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "treatment_plan_statuses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
-- Seed: explicit ids, mirrored in src/core/db/vocabulary-seed.ts
--> statement-breakpoint
INSERT INTO "clinic_statuses" ("id", "code", "label", "sort_order") VALUES
  (1, 'trial', 'Trial', 1),
  (2, 'active', 'Active', 2),
  (3, 'suspended', 'Suspended', 3),
  (4, 'past_due', 'Past due', 4),
  (5, 'cancelled', 'Cancelled', 5)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "billing_cycles" ("id", "code", "label", "sort_order") VALUES
  (1, 'monthly', 'Monthly', 1),
  (2, '2m', '2-monthly', 2),
  (3, 'quarter', 'Quarterly', 3),
  (4, 'half', 'Half-yearly', 4),
  (5, 'annual', 'Annual', 5)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "invoice_papers" ("id", "code", "label", "sort_order") VALUES
  (1, 'thermal', 'Thermal', 1),
  (2, 'a5', 'A5', 2),
  (3, 'a4', 'A4', 3)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "treatment_plan_statuses" ("id", "code", "label", "sort_order") VALUES
  (1, 'proposed', 'Proposed', 1),
  (2, 'active', 'Active', 2),
  (3, 'completed', 'Completed', 3),
  (4, 'cancelled', 'Cancelled', 4)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "treatment_item_statuses" ("id", "code", "label", "sort_order") VALUES
  (1, 'planned', 'Planned', 1),
  (2, 'in_progress', 'In progress', 2),
  (3, 'done', 'Done', 3),
  (4, 'cancelled', 'Cancelled', 4)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "attachment_kinds" ("id", "code", "label", "sort_order") VALUES
  (1, 'xray', 'X-ray', 1),
  (2, 'photo', 'Photo', 2),
  (3, 'document', 'Document', 3),
  (4, 'consent', 'Consent', 4)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "import_batch_statuses" ("id", "code", "label", "sort_order") VALUES
  (1, 'active', 'Active', 1),
  (2, 'undone', 'Undone', 2)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "announcement_levels" ("id", "code", "label", "sort_order") VALUES
  (1, 'info', 'Info', 1),
  (2, 'warning', 'Warning', 2)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "ai_providers" ("id", "code", "label", "sort_order") VALUES
  (1, 'whisper', 'Whisper', 1),
  (2, 'claude', 'Claude', 2)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "tax_modes" ("id", "code", "label", "sort_order") VALUES
  (1, 'itemized', 'Itemised', 1),
  (2, 'total', 'Single total', 2)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "recurrences" ("id", "code", "label", "sort_order") VALUES
  (1, 'monthly', 'Monthly', 1),
  (2, 'weekly', 'Weekly', 2)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "appointment_sources" ("id", "code", "label", "sort_order") VALUES
  (1, 'staff', 'Staff', 1),
  (2, 'whatsapp', 'WhatsApp', 2)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- Convert each column, preserving every row's meaning through a literal CASE
--> statement-breakpoint
ALTER TABLE "clinics" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "clinics" ALTER COLUMN "status" SET DATA TYPE integer USING (
  CASE "status"
    WHEN 'trial' THEN 1
    WHEN 'active' THEN 2
    WHEN 'suspended' THEN 3
    WHEN 'past_due' THEN 4
    WHEN 'cancelled' THEN 5
  END
);
--> statement-breakpoint
ALTER TABLE "clinics" ALTER COLUMN "status" SET DEFAULT 2;
--> statement-breakpoint
ALTER TABLE "clinics" ALTER COLUMN "billing_cycle" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "clinics" ALTER COLUMN "billing_cycle" SET DATA TYPE integer USING (
  CASE "billing_cycle"
    WHEN 'monthly' THEN 1
    WHEN '2m' THEN 2
    WHEN 'quarter' THEN 3
    WHEN 'half' THEN 4
    WHEN 'annual' THEN 5
  END
);
--> statement-breakpoint
ALTER TABLE "clinics" ALTER COLUMN "billing_cycle" SET DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "clinics" ALTER COLUMN "invoice_paper" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "clinics" ALTER COLUMN "invoice_paper" SET DATA TYPE integer USING (
  CASE "invoice_paper"
    WHEN 'thermal' THEN 1
    WHEN 'a5' THEN 2
    WHEN 'a4' THEN 3
  END
);
--> statement-breakpoint
ALTER TABLE "clinics" ALTER COLUMN "invoice_paper" SET DEFAULT 3;
--> statement-breakpoint
ALTER TABLE "treatment_plans" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "treatment_plans" ALTER COLUMN "status" SET DATA TYPE integer USING (
  CASE "status"
    WHEN 'proposed' THEN 1
    WHEN 'active' THEN 2
    WHEN 'completed' THEN 3
    WHEN 'cancelled' THEN 4
  END
);
--> statement-breakpoint
ALTER TABLE "treatment_plans" ALTER COLUMN "status" SET DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ALTER COLUMN "status" SET DATA TYPE integer USING (
  CASE "status"
    WHEN 'planned' THEN 1
    WHEN 'in_progress' THEN 2
    WHEN 'done' THEN 3
    WHEN 'cancelled' THEN 4
  END
);
--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ALTER COLUMN "status" SET DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "clinical_attachments" ALTER COLUMN "kind" SET DATA TYPE integer USING (
  CASE "kind"
    WHEN 'xray' THEN 1
    WHEN 'photo' THEN 2
    WHEN 'document' THEN 3
    WHEN 'consent' THEN 4
  END
);
--> statement-breakpoint
ALTER TABLE "import_batches" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "import_batches" ALTER COLUMN "status" SET DATA TYPE integer USING (
  CASE "status"
    WHEN 'active' THEN 1
    WHEN 'undone' THEN 2
  END
);
--> statement-breakpoint
ALTER TABLE "import_batches" ALTER COLUMN "status" SET DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "announcements" ALTER COLUMN "level" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "announcements" ALTER COLUMN "level" SET DATA TYPE integer USING (
  CASE "level"
    WHEN 'info' THEN 1
    WHEN 'warning' THEN 2
  END
);
--> statement-breakpoint
ALTER TABLE "announcements" ALTER COLUMN "level" SET DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "ai_usage" ALTER COLUMN "provider" SET DATA TYPE integer USING (
  CASE "provider"
    WHEN 'whisper' THEN 1
    WHEN 'claude' THEN 2
  END
);
--> statement-breakpoint
ALTER TABLE "platform_cost_rates" ALTER COLUMN "tax_mode" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "platform_cost_rates" ALTER COLUMN "tax_mode" SET DATA TYPE integer USING (
  CASE "tax_mode"
    WHEN 'itemized' THEN 1
    WHEN 'total' THEN 2
  END
);
--> statement-breakpoint
ALTER TABLE "platform_cost_rates" ALTER COLUMN "tax_mode" SET DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "recurrence" SET DATA TYPE integer USING (
  CASE "recurrence"
    WHEN 'monthly' THEN 1
    WHEN 'weekly' THEN 2
  END
);
--> statement-breakpoint
ALTER TABLE "company_expenses" ALTER COLUMN "recurrence" SET DATA TYPE integer USING (
  CASE "recurrence"
    WHEN 'monthly' THEN 1
    WHEN 'weekly' THEN 2
  END
);
--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "source" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "source" SET DATA TYPE integer USING (
  CASE "source"
    WHEN 'staff' THEN 1
    WHEN 'whatsapp' THEN 2
  END
);
--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "source" SET DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurrence_recurrences_id_fk" FOREIGN KEY ("recurrence") REFERENCES "public"."recurrences"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "clinical_attachments" ADD CONSTRAINT "clinical_attachments_kind_attachment_kinds_id_fk" FOREIGN KEY ("kind") REFERENCES "public"."attachment_kinds"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_status_treatment_item_statuses_id_fk" FOREIGN KEY ("status") REFERENCES "public"."treatment_item_statuses"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_status_treatment_plan_statuses_id_fk" FOREIGN KEY ("status") REFERENCES "public"."treatment_plan_statuses"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_invoice_paper_invoice_papers_id_fk" FOREIGN KEY ("invoice_paper") REFERENCES "public"."invoice_papers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_status_clinic_statuses_id_fk" FOREIGN KEY ("status") REFERENCES "public"."clinic_statuses"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_billing_cycle_billing_cycles_id_fk" FOREIGN KEY ("billing_cycle") REFERENCES "public"."billing_cycles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_source_appointment_sources_id_fk" FOREIGN KEY ("source") REFERENCES "public"."appointment_sources"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_provider_ai_providers_id_fk" FOREIGN KEY ("provider") REFERENCES "public"."ai_providers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_level_announcement_levels_id_fk" FOREIGN KEY ("level") REFERENCES "public"."announcement_levels"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "company_expenses" ADD CONSTRAINT "company_expenses_recurrence_recurrences_id_fk" FOREIGN KEY ("recurrence") REFERENCES "public"."recurrences"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_status_import_batch_statuses_id_fk" FOREIGN KEY ("status") REFERENCES "public"."import_batch_statuses"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "platform_cost_rates" ADD CONSTRAINT "platform_cost_rates_tax_mode_tax_modes_id_fk" FOREIGN KEY ("tax_mode") REFERENCES "public"."tax_modes"("id") ON DELETE no action ON UPDATE no action;
