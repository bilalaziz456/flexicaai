-- The dental MODULE's own vocabularies (ADR-028). Two lookup tables and two foreign
-- keys on `lab_cases`, owned by the module and living in its own schema file.
--
-- The point of this migration is not the two tables; it is that a specialty can now
-- have vocabularies at all without core learning that specialties exist. Core walks
-- only what it is GIVEN: the module declares these on its ModuleDefinition, the
-- registry aggregates, and the app injects at start-up — the same seam
-- `config/module-trash.ts` already uses to hand core a module's Trash provider.
--
-- Same three drizzle-kit corrections as 0090/0092: the USING clause it omits (a text
-- column will not cast to integer implicitly, and the transform may not contain a
-- SUBQUERY, so it is a literal CASE), and the code-string default it writes onto an
-- integer column.
--
-- `lab_cases.item` had free text with a fallback of 'crown'; any row outside the
-- vocabulary yields NULL from the CASE and the NOT NULL then fails the migration
-- rather than silently reclassifying someone's crown as a denture.
--> statement-breakpoint
CREATE TABLE "dental_lab_items" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "dental_lab_items_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "dental_lab_statuses" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "dental_lab_statuses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
-- Seed: explicit ids, mirrored in src/modules/dental/vocabulary.ts
--> statement-breakpoint
INSERT INTO "dental_lab_statuses" ("id", "code", "label", "sort_order") VALUES
  (1, 'sent', 'Sent to lab', 1),
  (2, 'in_lab', 'In lab', 2),
  (3, 'received', 'Received back', 3),
  (4, 'fitted', 'Fitted', 4),
  (5, 'remake', 'Remake', 5)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "dental_lab_items" ("id", "code", "label", "sort_order") VALUES
  (1, 'crown', 'Crown', 1),
  (2, 'bridge', 'Bridge', 2),
  (3, 'denture', 'Denture', 3),
  (4, 'veneer', 'Veneer', 4),
  (5, 'inlay/onlay', 'Inlay / onlay', 5),
  (6, 'implant crown', 'Implant crown', 6),
  (7, 'retainer', 'Retainer', 7),
  (8, 'other', 'Other', 8)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- Convert, preserving every row's meaning
--> statement-breakpoint
ALTER TABLE "lab_cases" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "lab_cases" ALTER COLUMN "status" SET DATA TYPE integer USING (
  CASE "status"
    WHEN 'sent' THEN 1
    WHEN 'in_lab' THEN 2
    WHEN 'received' THEN 3
    WHEN 'fitted' THEN 4
    WHEN 'remake' THEN 5
  END
);
--> statement-breakpoint
ALTER TABLE "lab_cases" ALTER COLUMN "status" SET DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "lab_cases" ALTER COLUMN "item" SET DATA TYPE integer USING (
  CASE "item"
    WHEN 'crown' THEN 1
    WHEN 'bridge' THEN 2
    WHEN 'denture' THEN 3
    WHEN 'veneer' THEN 4
    WHEN 'inlay/onlay' THEN 5
    WHEN 'implant crown' THEN 6
    WHEN 'retainer' THEN 7
    WHEN 'other' THEN 8
  END
);
--> statement-breakpoint
ALTER TABLE "lab_cases" ADD CONSTRAINT "lab_cases_item_dental_lab_items_id_fk" FOREIGN KEY ("item") REFERENCES "public"."dental_lab_items"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "lab_cases" ADD CONSTRAINT "lab_cases_status_dental_lab_statuses_id_fk" FOREIGN KEY ("status") REFERENCES "public"."dental_lab_statuses"("id") ON DELETE no action ON UPDATE no action;
