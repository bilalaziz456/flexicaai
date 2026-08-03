ALTER TABLE "platform_cost_rates" ADD COLUMN "tax_mode" text DEFAULT 'itemized' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_cost_rates" ADD COLUMN "foreign_txn_fee_pct" numeric(12, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_cost_rates" ADD COLUMN "fed_pct" numeric(12, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_cost_rates" ADD COLUMN "advance_tax_pct" numeric(12, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_cost_rates" ADD COLUMN "additional_tax_pct" numeric(12, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_cost_rates" ADD COLUMN "total_tax_pct" numeric(12, 4) DEFAULT '0' NOT NULL;