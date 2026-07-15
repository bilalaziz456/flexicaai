CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"invoice_no" integer NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_by" uuid,
	"issued_by_name" text,
	"note" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_group" uuid,
	"deleted_by_cascade" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"kind" text NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"method" text,
	"reference" text,
	"note" text,
	"reverses_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_by_name" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_group" uuid,
	"deleted_by_cascade" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "amount_collected" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "invoice_paper" text DEFAULT 'a4' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "invoice_prefix" text DEFAULT 'INV-' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "next_invoice_no" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_payments" ADD CONSTRAINT "patient_payments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_payments" ADD CONSTRAINT "patient_payments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_payments" ADD CONSTRAINT "patient_payments_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_appointment_unique" ON "invoices" USING btree ("appointment_id") WHERE "invoices"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_clinic_no_unique" ON "invoices" USING btree ("clinic_id","invoice_no");--> statement-breakpoint
CREATE INDEX "invoices_clinic_issued_idx" ON "invoices" USING btree ("clinic_id","issued_at");--> statement-breakpoint
CREATE INDEX "invoices_patient_idx" ON "invoices" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "patient_payments_clinic_patient_idx" ON "patient_payments" USING btree ("clinic_id","patient_id");--> statement-breakpoint
CREATE INDEX "patient_payments_appointment_idx" ON "patient_payments" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "patient_payments_clinic_occurred_idx" ON "patient_payments" USING btree ("clinic_id","occurred_at");--> statement-breakpoint
CREATE INDEX "patient_payments_deleted_idx" ON "patient_payments" USING btree ("clinic_id","deleted_at") WHERE "patient_payments"."deleted_at" is not null;