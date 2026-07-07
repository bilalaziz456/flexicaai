CREATE TYPE "public"."whatsapp_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_status" AS ENUM('queued', 'sent', 'delivered', 'read', 'failed', 'received');--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid,
	"patient_id" uuid,
	"direction" "whatsapp_direction" NOT NULL,
	"phone" text NOT NULL,
	"status" "whatsapp_status" DEFAULT 'queued' NOT NULL,
	"template_name" text,
	"body" text,
	"media_url" text,
	"external_id" text,
	"error" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wa_messages_clinic_id_idx" ON "whatsapp_messages" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "wa_messages_patient_id_idx" ON "whatsapp_messages" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "wa_messages_phone_idx" ON "whatsapp_messages" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "wa_messages_clinic_created_idx" ON "whatsapp_messages" USING btree ("clinic_id","created_at");--> statement-breakpoint
CREATE INDEX "wa_messages_external_id_idx" ON "whatsapp_messages" USING btree ("external_id");