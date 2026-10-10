ALTER TABLE "procedures" ADD COLUMN "offer_type_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "procedures" ADD COLUMN "offer_value" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "procedures" ADD COLUMN "offer_starts_on" date;--> statement-breakpoint
ALTER TABLE "procedures" ADD COLUMN "offer_ends_on" date;--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_offer_type_id_discount_types_id_fk" FOREIGN KEY ("offer_type_id") REFERENCES "public"."discount_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_percent_offer_max" CHECK ("procedures"."offer_type_id" <> 2 or "procedures"."offer_value" between 0 and 100);--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_offer_dates_order" CHECK ("procedures"."offer_ends_on" is null or "procedures"."offer_starts_on" is null or "procedures"."offer_ends_on" >= "procedures"."offer_starts_on");