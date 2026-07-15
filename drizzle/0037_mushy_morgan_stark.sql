CREATE TABLE "doctor_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"doctor_id" uuid,
	"doctor_name" text,
	"amount" integer DEFAULT 0 NOT NULL,
	"period_start" date,
	"period_end" date,
	"note" text,
	"created_by" uuid,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "doctor_payouts" ADD CONSTRAINT "doctor_payouts_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_payouts" ADD CONSTRAINT "doctor_payouts_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doctor_payouts_clinic_doctor_idx" ON "doctor_payouts" USING btree ("clinic_id","doctor_id");--> statement-breakpoint
CREATE INDEX "doctor_payouts_clinic_created_idx" ON "doctor_payouts" USING btree ("clinic_id","created_at");--> statement-breakpoint
ALTER TABLE "sale_shares" ADD CONSTRAINT "sale_shares_payout_id_doctor_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."doctor_payouts"("id") ON DELETE set null ON UPDATE no action;