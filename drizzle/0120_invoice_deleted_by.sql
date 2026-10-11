ALTER TABLE "invoices" ADD COLUMN "voided_by" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "voided_by_name" text;