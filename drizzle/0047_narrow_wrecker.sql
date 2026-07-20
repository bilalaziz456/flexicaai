CREATE TABLE "clinical_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"visit_id" uuid,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text,
	"caption" text,
	"taken_at" timestamp with time zone,
	"is_photo" boolean DEFAULT false NOT NULL,
	"uploaded_by" uuid,
	"uploaded_by_name" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_group" uuid,
	"deleted_by_cascade" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "photo_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinical_attachments" ADD CONSTRAINT "clinical_attachments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_attachments" ADD CONSTRAINT "clinical_attachments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_attachments" ADD CONSTRAINT "clinical_attachments_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinical_attachments_patient_idx" ON "clinical_attachments" USING btree ("clinic_id","patient_id");--> statement-breakpoint
CREATE INDEX "clinical_attachments_visit_idx" ON "clinical_attachments" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "clinical_attachments_deleted_idx" ON "clinical_attachments" USING btree ("clinic_id","deleted_at") WHERE "clinical_attachments"."deleted_at" is not null;