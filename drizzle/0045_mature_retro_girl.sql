CREATE TABLE "perio_exams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"visit_id" uuid,
	"exam_date" timestamp with time zone DEFAULT now() NOT NULL,
	"teeth" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"bop_percent" integer DEFAULT 0 NOT NULL,
	"note" text,
	"charted_by" uuid,
	"charted_by_name" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_group" uuid,
	"deleted_by_cascade" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "perio_exams" ADD CONSTRAINT "perio_exams_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perio_exams" ADD CONSTRAINT "perio_exams_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perio_exams" ADD CONSTRAINT "perio_exams_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "perio_exams_clinic_idx" ON "perio_exams" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "perio_exams_patient_idx" ON "perio_exams" USING btree ("clinic_id","patient_id","exam_date");--> statement-breakpoint
CREATE INDEX "perio_exams_deleted_idx" ON "perio_exams" USING btree ("clinic_id","deleted_at") WHERE "perio_exams"."deleted_at" is not null;