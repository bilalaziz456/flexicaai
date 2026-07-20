CREATE TABLE "lab_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"visit_id" uuid,
	"plan_item_id" uuid,
	"lab_name" text,
	"item" text NOT NULL,
	"tooth" text,
	"shade" text,
	"status" text DEFAULT 'sent' NOT NULL,
	"sent_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"cost" integer,
	"note" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_group" uuid,
	"deleted_by_cascade" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lab_cases" ADD CONSTRAINT "lab_cases_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_cases" ADD CONSTRAINT "lab_cases_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_cases" ADD CONSTRAINT "lab_cases_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_cases" ADD CONSTRAINT "lab_cases_plan_item_id_treatment_plan_items_id_fk" FOREIGN KEY ("plan_item_id") REFERENCES "public"."treatment_plan_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lab_cases_patient_idx" ON "lab_cases" USING btree ("clinic_id","patient_id");--> statement-breakpoint
CREATE INDEX "lab_cases_status_idx" ON "lab_cases" USING btree ("clinic_id","status");--> statement-breakpoint
CREATE INDEX "lab_cases_deleted_idx" ON "lab_cases" USING btree ("clinic_id","deleted_at") WHERE "lab_cases"."deleted_at" is not null;