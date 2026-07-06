CREATE TYPE "public"."appointment_status" AS ENUM('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."recall_status" AS ENUM('pending', 'scheduled', 'sent', 'booked', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."visit_status" AS ENUM('draft', 'approved');--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid,
	"module" text,
	"scheduled_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"status" "appointment_status" DEFAULT 'scheduled' NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"email" text,
	"date_of_birth" date,
	"gender" text,
	"address" text,
	"notes" text,
	"data_consent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recalls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"source_visit_id" uuid,
	"module" text,
	"reason" text,
	"due_at" timestamp with time zone NOT NULL,
	"status" "recall_status" DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"doctor_id" uuid,
	"module" text,
	"status" "visit_status" DEFAULT 'draft' NOT NULL,
	"transcript" text,
	"note" jsonb,
	"visit_date" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recalls" ADD CONSTRAINT "recalls_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recalls" ADD CONSTRAINT "recalls_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recalls" ADD CONSTRAINT "recalls_source_visit_id_visits_id_fk" FOREIGN KEY ("source_visit_id") REFERENCES "public"."visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_clinic_id_idx" ON "appointments" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "appointments_patient_id_idx" ON "appointments" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "appointments_clinic_scheduled_idx" ON "appointments" USING btree ("clinic_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "appointments_doctor_id_idx" ON "appointments" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "patients_clinic_id_idx" ON "patients" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "patients_clinic_phone_idx" ON "patients" USING btree ("clinic_id","phone");--> statement-breakpoint
CREATE INDEX "patients_clinic_name_idx" ON "patients" USING btree ("clinic_id","full_name");--> statement-breakpoint
CREATE INDEX "recalls_clinic_id_idx" ON "recalls" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "recalls_patient_id_idx" ON "recalls" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "recalls_clinic_due_idx" ON "recalls" USING btree ("clinic_id","due_at");--> statement-breakpoint
CREATE INDEX "recalls_status_idx" ON "recalls" USING btree ("status");--> statement-breakpoint
CREATE INDEX "visits_clinic_id_idx" ON "visits" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "visits_patient_id_idx" ON "visits" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "visits_clinic_date_idx" ON "visits" USING btree ("clinic_id","visit_date");--> statement-breakpoint
CREATE INDEX "visits_appointment_id_idx" ON "visits" USING btree ("appointment_id");