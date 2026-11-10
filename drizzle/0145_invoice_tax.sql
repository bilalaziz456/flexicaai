ALTER TABLE "clinic_invoices" ADD COLUMN "tax_label" text;--> statement-breakpoint
ALTER TABLE "clinic_invoices" ADD COLUMN "tax_rate" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "clinic_invoices" ADD COLUMN "tax_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "tax_label" text DEFAULT 'Sales tax' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "tax_rate" numeric(5, 2) DEFAULT '16' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "ntn" text;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "strn" text;