ALTER TYPE "public"."visit_status" ADD VALUE 'transcribing' BEFORE 'draft';--> statement-breakpoint
ALTER TYPE "public"."visit_status" ADD VALUE 'failed';--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "transcribe_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "transcribe_error" text;