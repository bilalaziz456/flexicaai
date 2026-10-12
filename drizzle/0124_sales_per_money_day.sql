DROP INDEX "sales_appointment_unique";--> statement-breakpoint
CREATE INDEX "sales_appointment_idx" ON "sales" USING btree ("appointment_id");