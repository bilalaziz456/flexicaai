CREATE TABLE "discount_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"party" text NOT NULL,
	"doctor_id" uuid,
	"doctor_name" text,
	"gross_share" integer DEFAULT 0 NOT NULL,
	"settlement_amount" integer DEFAULT 0 NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctor_settlement_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"doctor_id" uuid,
	"doctor_name" text,
	"appointment_id" uuid,
	"line_ref" text,
	"kind" text NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"reverses_id" uuid,
	"note" text,
	"created_by" uuid,
	"created_by_name" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "discount_split_type" text DEFAULT 'percent' NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "discount_split_value" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "discount_split_stale" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_settlements" ADD CONSTRAINT "discount_settlements_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_settlements" ADD CONSTRAINT "discount_settlements_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_settlements" ADD CONSTRAINT "discount_settlements_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_settlement_actions" ADD CONSTRAINT "doctor_settlement_actions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_settlement_actions" ADD CONSTRAINT "doctor_settlement_actions_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_settlement_actions" ADD CONSTRAINT "doctor_settlement_actions_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discount_settlements_appointment_idx" ON "discount_settlements" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "discount_settlements_clinic_occurred_idx" ON "discount_settlements" USING btree ("clinic_id","occurred_at");--> statement-breakpoint
CREATE INDEX "discount_settlements_clinic_doctor_idx" ON "discount_settlements" USING btree ("clinic_id","doctor_id");--> statement-breakpoint
CREATE INDEX "doctor_settlement_actions_clinic_doctor_idx" ON "doctor_settlement_actions" USING btree ("clinic_id","doctor_id");--> statement-breakpoint
CREATE INDEX "doctor_settlement_actions_clinic_occurred_idx" ON "doctor_settlement_actions" USING btree ("clinic_id","occurred_at");--> statement-breakpoint
CREATE INDEX "doctor_settlement_actions_appointment_idx" ON "doctor_settlement_actions" USING btree ("appointment_id");