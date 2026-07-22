CREATE TABLE "clinic_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"invoice_no" integer NOT NULL,
	"period_start" date,
	"period_end" date,
	"amount" integer DEFAULT 0 NOT NULL,
	"note" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_by" uuid,
	"issued_by_name" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_group" uuid,
	"deleted_by_cascade" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"next_invoice_no" integer DEFAULT 1 NOT NULL,
	"invoice_prefix" text DEFAULT 'KL-INV-' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clinic_invoices" ADD CONSTRAINT "clinic_invoices_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_invoices_no_unique" ON "clinic_invoices" USING btree ("invoice_no");--> statement-breakpoint
CREATE INDEX "clinic_invoices_clinic_idx" ON "clinic_invoices" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "clinic_invoices_issued_idx" ON "clinic_invoices" USING btree ("issued_at");--> statement-breakpoint
CREATE INDEX "clinic_invoices_deleted_idx" ON "clinic_invoices" USING btree ("deleted_at") WHERE "clinic_invoices"."deleted_at" is not null;