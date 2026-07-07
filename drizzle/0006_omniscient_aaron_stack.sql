CREATE INDEX "patients_name_trgm_idx" ON "patients" USING gin ("full_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "patients_phone_trgm_idx" ON "patients" USING gin ("phone" gin_trgm_ops);