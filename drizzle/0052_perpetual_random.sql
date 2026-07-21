CREATE TABLE "clinic_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"method" text,
	"reference" text,
	"months_covered" integer DEFAULT 1 NOT NULL,
	"note" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" uuid,
	"recorded_by_name" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_group" uuid,
	"deleted_by_cascade" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "suspend_reason" text;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "owner_name" text;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "owner_email" text;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "owner_phone" text;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "timezone" text DEFAULT 'Asia/Karachi' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "monthly_price" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "billing_cycle" text DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "grace_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "capabilities" text[];--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "impersonated_clinic_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_backup" text[];--> statement-breakpoint
ALTER TABLE "clinic_payments" ADD CONSTRAINT "clinic_payments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinic_payments_clinic_occurred_idx" ON "clinic_payments" USING btree ("clinic_id","occurred_at");--> statement-breakpoint
CREATE INDEX "clinic_payments_deleted_idx" ON "clinic_payments" USING btree ("deleted_at") WHERE "clinic_payments"."deleted_at" is not null;