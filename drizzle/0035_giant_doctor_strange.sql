CREATE TABLE "appointment_discount_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"approver_kind" text NOT NULL,
	"approver_doctor_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_by_name" text,
	"decided_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "discount_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "appointment_discount_approvals" ADD CONSTRAINT "appointment_discount_approvals_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_discount_approvals" ADD CONSTRAINT "appointment_discount_approvals_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_discount_approvals" ADD CONSTRAINT "appointment_discount_approvals_approver_doctor_id_users_id_fk" FOREIGN KEY ("approver_doctor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appt_discount_approvals_appt_idx" ON "appointment_discount_approvals" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "appt_discount_approvals_clinic_status_idx" ON "appointment_discount_approvals" USING btree ("clinic_id","status");--> statement-breakpoint
CREATE INDEX "appt_discount_approvals_doctor_status_idx" ON "appointment_discount_approvals" USING btree ("approver_doctor_id","status");