CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "clinics_name_trgm_idx" ON "clinics" USING gin ("name" gin_trgm_ops);
