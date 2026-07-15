CREATE TABLE "sale_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"doctor_id" uuid,
	"doctor_name" text,
	"share_amount" integer DEFAULT 0 NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"payout_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sale_shares" ADD CONSTRAINT "sale_shares_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_shares" ADD CONSTRAINT "sale_shares_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_shares" ADD CONSTRAINT "sale_shares_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_shares_appointment_idx" ON "sale_shares" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "sale_shares_clinic_occurred_idx" ON "sale_shares" USING btree ("clinic_id","occurred_at");--> statement-breakpoint
CREATE INDEX "sale_shares_doctor_payout_idx" ON "sale_shares" USING btree ("doctor_id","payout_id");