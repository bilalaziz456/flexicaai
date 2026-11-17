ALTER TABLE "company_settings" ALTER COLUMN "next_invoice_no" SET DEFAULT 1001;--> statement-breakpoint
UPDATE "company_settings" SET "next_invoice_no" = 1001 WHERE "next_invoice_no" < 1001;