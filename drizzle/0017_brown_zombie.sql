ALTER TABLE "appointments" ADD COLUMN "discount_type" text DEFAULT 'amount' NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "discount_value" integer DEFAULT 0 NOT NULL;