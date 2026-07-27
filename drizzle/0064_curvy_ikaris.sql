ALTER TABLE "clinics" ADD COLUMN "mrn_prefix" text DEFAULT 'MRN-' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "next_mrn" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "mrn" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "patients_clinic_mrn_idx" ON "patients" USING btree ("clinic_id","mrn") WHERE "patients"."mrn" is not null;--> statement-breakpoint
-- Backfill: give every existing patient a per-clinic MRN in creation order (soft-
-- deleted rows included, so a restored patient keeps its number).
UPDATE "patients" p SET "mrn" = n.rn FROM (
  SELECT "id", row_number() OVER (PARTITION BY "clinic_id" ORDER BY "created_at", "id") AS rn
  FROM "patients"
) n WHERE p."id" = n."id";--> statement-breakpoint
-- Advance each clinic's counter past its highest assigned MRN.
UPDATE "clinics" c SET "next_mrn" = COALESCE(
  (SELECT max(p."mrn") + 1 FROM "patients" p WHERE p."clinic_id" = c."id"), 1
);