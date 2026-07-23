ALTER TABLE "company_settings" ADD COLUMN "thin_margin_pct" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "spike_multiple" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "spike_floor_pkr" integer DEFAULT 200 NOT NULL;