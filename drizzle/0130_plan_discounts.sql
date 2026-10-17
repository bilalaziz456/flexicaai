-- Plan discounts (owner's call, 2026-10-18). Vocabulary defaults are written as IDS
-- (amount = 1, percent = 2, clinic = 1): drizzle-kit renders a custom type's code
-- literally onto an integer column (ADR-027), so they were corrected by hand.
ALTER TABLE "treatment_plan_items" ADD COLUMN "offer_type_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD COLUMN "offer_value" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD COLUMN "discount_type_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD COLUMN "discount_value" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD COLUMN "doctor_id" uuid;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD COLUMN "discount_type_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD COLUMN "discount_value" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD COLUMN "discount_borne_by_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD COLUMN "discount_split_type_id" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD COLUMN "discount_split_value" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "discount_from_plan" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_offer_type_id_discount_types_id_fk" FOREIGN KEY ("offer_type_id") REFERENCES "public"."discount_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_discount_type_id_discount_types_id_fk" FOREIGN KEY ("discount_type_id") REFERENCES "public"."discount_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_discount_type_id_discount_types_id_fk" FOREIGN KEY ("discount_type_id") REFERENCES "public"."discount_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_discount_borne_by_id_discount_bearers_id_fk" FOREIGN KEY ("discount_borne_by_id") REFERENCES "public"."discount_bearers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_discount_split_type_id_discount_types_id_fk" FOREIGN KEY ("discount_split_type_id") REFERENCES "public"."discount_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_percent_offer_max" CHECK ("treatment_plan_items"."offer_type_id" <> 2 or "treatment_plan_items"."offer_value" between 0 and 100);--> statement-breakpoint
ALTER TABLE "treatment_plan_items" ADD CONSTRAINT "treatment_plan_items_percent_discount_max" CHECK ("treatment_plan_items"."discount_type_id" <> 2 or "treatment_plan_items"."discount_value" between 0 and 100);--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_percent_discount_max" CHECK ("treatment_plans"."discount_type_id" <> 2 or "treatment_plans"."discount_value" between 0 and 100);--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_percent_split_max" CHECK ("treatment_plans"."discount_split_type_id" <> 2 or "treatment_plans"."discount_split_value" between 0 and 100);