ALTER TABLE "clinics" ADD COLUMN "trial_start_at" timestamp with time zone;--> statement-breakpoint
-- Backfill: existing trial clinics get their creation moment as the trial start.
UPDATE "clinics" SET "trial_start_at" = "created_at" WHERE "status" = 'trial' AND "trial_start_at" IS NULL;
