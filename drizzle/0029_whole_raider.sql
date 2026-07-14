ALTER TABLE "clinics" ADD COLUMN "whatsapp_phone_number_id" text;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "whatsapp_display_number" text;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "whatsapp_sender_name" text;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "whatsapp_signature" text;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "whatsapp_notes" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "clinics_wa_phone_id_idx" ON "clinics" USING btree ("whatsapp_phone_number_id") WHERE "clinics"."whatsapp_phone_number_id" is not null;