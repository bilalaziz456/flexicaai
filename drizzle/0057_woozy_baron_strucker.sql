CREATE TABLE "platform_cost_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scribe_call_cost" numeric(12, 6) DEFAULT '0' NOT NULL,
	"whatsapp_msg_cost" numeric(12, 6) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"usd_to_pkr" numeric(12, 4) DEFAULT '0' NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "platform_cost_rates_effective_idx" ON "platform_cost_rates" USING btree ("effective_from");