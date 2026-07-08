ALTER TABLE "users" ADD COLUMN "availability" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "daily_appointment_limit" integer DEFAULT 0 NOT NULL;