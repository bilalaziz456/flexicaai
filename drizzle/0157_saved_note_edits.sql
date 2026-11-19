CREATE TABLE "clinical_note_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"note" jsonb,
	"edited_by" uuid,
	"edited_by_name" text,
	"edited_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "edited_by" uuid;--> statement-breakpoint
ALTER TABLE "clinical_note_versions" ADD CONSTRAINT "clinical_note_versions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_note_versions" ADD CONSTRAINT "clinical_note_versions_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_note_versions" ADD CONSTRAINT "clinical_note_versions_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinical_note_versions_visit_idx" ON "clinical_note_versions" USING btree ("clinic_id","visit_id","edited_at");--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- A SAVED note is edited with `clinical:edit` and deleted with the new `clinical:delete`
-- (owner, 2026-11-19/20) — on the Clinical notes row of the access grid. Delete is the
-- clinic admin's by default (role defaults); a clinic whose capabilities are restricted
-- but include writing notes may have it too (NULL = everything allowed), so its admin
-- can grant it to whoever they choose.
UPDATE "clinics" SET "capabilities" = array_append("capabilities", 'clinical:delete') WHERE "capabilities" IS NOT NULL AND 'clinical:create' = ANY("capabilities") AND NOT ('clinical:delete' = ANY("capabilities"));
