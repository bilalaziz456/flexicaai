CREATE TABLE "doctor_procedure_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"procedure_id" uuid NOT NULL,
	"share_pct" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointment_procedures" ADD COLUMN "doctor_id" uuid;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "discount_borne_by" text DEFAULT 'clinic' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "consultation_share_pct" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "procedure_share_pct" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "doctor_procedure_shares" ADD CONSTRAINT "doctor_procedure_shares_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_procedure_shares" ADD CONSTRAINT "doctor_procedure_shares_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_procedure_shares" ADD CONSTRAINT "doctor_procedure_shares_procedure_id_procedures_id_fk" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_procedure_shares_unique" ON "doctor_procedure_shares" USING btree ("doctor_id","procedure_id");--> statement-breakpoint
CREATE INDEX "doctor_procedure_shares_clinic_idx" ON "doctor_procedure_shares" USING btree ("clinic_id");--> statement-breakpoint
ALTER TABLE "appointment_procedures" ADD CONSTRAINT "appointment_procedures_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;