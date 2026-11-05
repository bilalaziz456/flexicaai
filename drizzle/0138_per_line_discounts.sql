-- Per-line discounts, each with its own "Borne by" (docs/per-line-discount-plan.md,
-- owner's decisions 2026-11-06). ADDITIVE ONLY: every new column defaults to what
-- the app already did, so no bill, share or settlement changes for any existing row.
--
--  * discount_bearers gets id 4 "proportional" ("In proportion") — clinic OFFERS only:
--    the doctor's share is worked out on the price after the offer, the rule every
--    offer followed before it had a bearer. Written out, never sequenced; must match
--    DISCOUNT_BEARER_ROWS in vocabulary-seed.ts (scripts/test-vocabulary-tables.ts).
--    Inserted FIRST: the new columns below default to it and reference it.
--  * procedures / appointment_procedures: the offer's bearer (default proportional).
--  * appointment_procedures: a PATIENT discount per line with its own bearer, and
--    discount_from_plan per line.
--  * appointments: a consultation discount with its own bearer, and bearing_version
--    (1 = today's single-bearer rule for the whole visit; 2 = per line). Every
--    existing visit is 1 and stays 1 (decision 6).
--  * CHECKs: percents 0–100 (ADR-021), and "proportional" only ever on an offer.
--
-- Vocabulary defaults are written as IDS (1 amount / 2 percent / 1 clinic /
-- 4 proportional) — drizzle-kit emits the code, which Postgres cannot cast to
-- integer (as in 0117).
INSERT INTO "discount_bearers" ("id", "code", "label", "sort_order", "is_active")
VALUES (4, 'proportional', 'In proportion', 4, true)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "appointment_procedures" ADD COLUMN "offer_borne_by_id" integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "appointment_procedures" ADD COLUMN "offer_split_type_id" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "appointment_procedures" ADD COLUMN "offer_split_value" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "appointment_procedures" ADD COLUMN "patient_discount_type_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "appointment_procedures" ADD COLUMN "patient_discount_value" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "appointment_procedures" ADD COLUMN "discount_borne_by_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "appointment_procedures" ADD COLUMN "discount_split_type_id" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "appointment_procedures" ADD COLUMN "discount_split_value" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "appointment_procedures" ADD COLUMN "discount_from_plan" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "procedures" ADD COLUMN "offer_borne_by_id" integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "procedures" ADD COLUMN "offer_split_type_id" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "procedures" ADD COLUMN "offer_split_value" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "consultation_discount_type_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "consultation_discount_value" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "consultation_borne_by_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "consultation_split_type_id" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "consultation_split_value" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "bearing_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "appointment_procedures" ADD CONSTRAINT "appointment_procedures_offer_borne_by_id_discount_bearers_id_fk" FOREIGN KEY ("offer_borne_by_id") REFERENCES "public"."discount_bearers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_procedures" ADD CONSTRAINT "appointment_procedures_offer_split_type_id_discount_types_id_fk" FOREIGN KEY ("offer_split_type_id") REFERENCES "public"."discount_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_procedures" ADD CONSTRAINT "appointment_procedures_patient_discount_type_id_discount_types_id_fk" FOREIGN KEY ("patient_discount_type_id") REFERENCES "public"."discount_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_procedures" ADD CONSTRAINT "appointment_procedures_discount_borne_by_id_discount_bearers_id_fk" FOREIGN KEY ("discount_borne_by_id") REFERENCES "public"."discount_bearers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_procedures" ADD CONSTRAINT "appointment_procedures_discount_split_type_id_discount_types_id_fk" FOREIGN KEY ("discount_split_type_id") REFERENCES "public"."discount_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_offer_borne_by_id_discount_bearers_id_fk" FOREIGN KEY ("offer_borne_by_id") REFERENCES "public"."discount_bearers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_offer_split_type_id_discount_types_id_fk" FOREIGN KEY ("offer_split_type_id") REFERENCES "public"."discount_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_consultation_discount_type_id_discount_types_id_fk" FOREIGN KEY ("consultation_discount_type_id") REFERENCES "public"."discount_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_consultation_borne_by_id_discount_bearers_id_fk" FOREIGN KEY ("consultation_borne_by_id") REFERENCES "public"."discount_bearers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_consultation_split_type_id_discount_types_id_fk" FOREIGN KEY ("consultation_split_type_id") REFERENCES "public"."discount_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_procedures" ADD CONSTRAINT "appt_procedures_percent_patient_discount_max" CHECK ("appointment_procedures"."patient_discount_type_id" <> 2 or "appointment_procedures"."patient_discount_value" between 0 and 100);--> statement-breakpoint
ALTER TABLE "appointment_procedures" ADD CONSTRAINT "appt_procedures_percent_split_max" CHECK ("appointment_procedures"."discount_split_type_id" <> 2 or "appointment_procedures"."discount_split_value" between 0 and 100);--> statement-breakpoint
ALTER TABLE "appointment_procedures" ADD CONSTRAINT "appt_procedures_percent_offer_split_max" CHECK ("appointment_procedures"."offer_split_type_id" <> 2 or "appointment_procedures"."offer_split_value" between 0 and 100);--> statement-breakpoint
ALTER TABLE "appointment_procedures" ADD CONSTRAINT "appt_procedures_patient_bearer_not_proportional" CHECK ("appointment_procedures"."discount_borne_by_id" <> 4);--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_percent_offer_split_max" CHECK ("procedures"."offer_split_type_id" <> 2 or "procedures"."offer_split_value" between 0 and 100);--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_bearer_not_proportional" CHECK ("treatment_plans"."discount_borne_by_id" <> 4);--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_percent_consultation_discount_max" CHECK ("appointments"."consultation_discount_type_id" <> 2 or "appointments"."consultation_discount_value" between 0 and 100);--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_percent_consultation_split_max" CHECK ("appointments"."consultation_split_type_id" <> 2 or "appointments"."consultation_split_value" between 0 and 100);--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_bearers_not_proportional" CHECK ("appointments"."discount_borne_by_id" <> 4 and "appointments"."consultation_borne_by_id" <> 4);--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_bearing_version_known" CHECK ("appointments"."bearing_version" in (1, 2));