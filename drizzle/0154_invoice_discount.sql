ALTER TABLE "clinic_invoices" ADD COLUMN "discount_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_invoices" ADD COLUMN "discount_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "clinic_payments" ADD COLUMN "discount_of_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "clinic_payments" ADD CONSTRAINT "clinic_payments_discount_of_invoice_id_clinic_invoices_id_fk" FOREIGN KEY ("discount_of_invoice_id") REFERENCES "public"."clinic_invoices"("id") ON DELETE set null ON UPDATE no action;