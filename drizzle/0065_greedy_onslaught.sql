ALTER TABLE "clinics" ALTER COLUMN "mrn_prefix" SET DEFAULT 'KL-';--> statement-breakpoint
-- Move existing clinics off the old default prefix onto the new one (only those
-- still on the untouched default, so a custom prefix is never overwritten).
UPDATE "clinics" SET "mrn_prefix" = 'KL-' WHERE "mrn_prefix" = 'MRN-';