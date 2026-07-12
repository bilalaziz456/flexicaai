ALTER TABLE "appointments" ADD COLUMN "queue_session" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "queue_number" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_queue_unique" ON "appointments" USING btree ("clinic_id","queue_session","queue_number");