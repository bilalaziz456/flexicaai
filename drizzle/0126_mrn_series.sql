DROP INDEX "patients_clinic_mrn_idx";--> statement-breakpoint
ALTER TABLE "clinics" ALTER COLUMN "mrn_prefix" SET DEFAULT 'FA-';--> statement-breakpoint
ALTER TABLE "clinics" ALTER COLUMN "next_mrn" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "clinics" ALTER COLUMN "next_mrn" SET DEFAULT 100001;--> statement-breakpoint
ALTER TABLE "patients" ALTER COLUMN "mrn" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "mrn_width" integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "mrn_label" text;--> statement-breakpoint
-- Renumber every patient into the clinic's new series, FA-100001 onwards, in
-- registration order (owner's call, 2026-10-13 — safe ONLY because no clinic is live:
-- an MRN is on a patient's card, and must never be renumbered once one is). Trashed
-- patients are numbered too, so a restore can never collide with a number since given
-- to somebody else. The label is STORED from here on; the series can change later
-- without relabelling anyone.
UPDATE "patients" p
   SET "mrn" = 100000 + n.rn,
       "mrn_label" = 'FA-' || (100000 + n.rn)::text
  FROM (
    SELECT "id", row_number() OVER (PARTITION BY "clinic_id" ORDER BY "created_at", "id") AS rn
      FROM "patients"
  ) n
 WHERE p."id" = n."id";--> statement-breakpoint
UPDATE "clinics" c
   SET "mrn_prefix" = 'FA-',
       "mrn_width" = 6,
       "next_mrn" = 100001 + coalesce((SELECT count(*) FROM "patients" p WHERE p."clinic_id" = c."id"), 0);--> statement-breakpoint
CREATE UNIQUE INDEX "patients_clinic_mrn_label_idx" ON "patients" USING btree ("clinic_id","mrn_label") WHERE "patients"."mrn_label" is not null;--> statement-breakpoint
CREATE INDEX "patients_clinic_mrn_idx" ON "patients" USING btree ("clinic_id","mrn");