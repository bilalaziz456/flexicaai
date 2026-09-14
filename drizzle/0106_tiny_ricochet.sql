ALTER TABLE "announcements" ADD COLUMN "audience" text[];--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
CREATE INDEX "announcements_batch_idx" ON "announcements" USING btree ("batch_id");