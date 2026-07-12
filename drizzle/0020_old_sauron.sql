DROP INDEX "activity_logs_clinic_visible_idx";--> statement-breakpoint
DROP INDEX "activity_logs_visible_scan_idx";--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "log_access" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX "activity_logs_created_idx" ON "activity_logs" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "activity_logs" DROP COLUMN "visible";