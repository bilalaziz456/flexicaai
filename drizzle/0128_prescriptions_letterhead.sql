CREATE TABLE "prescriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"doctor_id" uuid,
	"doctor_name" text,
	"prescribed_on" date NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"print_doctor_name" boolean DEFAULT true NOT NULL,
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
ALTER TABLE "clinics" ADD COLUMN "letterhead_key" text;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "letterhead_top_mm" integer DEFAULT 45 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "letterhead_bottom_mm" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "letterhead_left_mm" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "letterhead_right_mm" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "rx_print_doctor_name" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prescriptions_patient_idx" ON "prescriptions" USING btree ("clinic_id","patient_id");--> statement-breakpoint
CREATE INDEX "prescriptions_deleted_idx" ON "prescriptions" USING btree ("clinic_id","deleted_at") WHERE "prescriptions"."deleted_at" is not null;