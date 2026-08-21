-- Percent discounts are capped at 100 (D-17). A percentage above 100 isn't a bigger
-- discount, it's a typo — and this field, unbounded, overflowed int4 inside the SQL
-- bill and made Postgres THROW where TypeScript quietly clamped, taking down every
-- list that aggregates bills for that clinic until the row was edited (ADR-021).
--
-- Clamp any existing rows FIRST: ADD CONSTRAINT validates existing data, so a single
-- bad row left over from before the app-side validation would fail the migration.
-- Clamping matches what the bill maths already did with these values (everything over
-- 100% is "free"), so no figure changes — only the stored number becomes honest.
UPDATE "appointments" SET "discount_value" = 100
 WHERE "discount_type" = 'percent' AND "discount_value" > 100;--> statement-breakpoint
UPDATE "appointments" SET "discount_split_value" = 100
 WHERE "discount_split_type" = 'percent' AND "discount_split_value" > 100;--> statement-breakpoint
UPDATE "appointment_procedures" SET "discount_value" = 100
 WHERE "discount_type" = 'percent' AND "discount_value" > 100;--> statement-breakpoint
-- Negative values were never reachable through the app, but the constraint covers the
-- lower bound too, so normalise them the same way rather than failing the migration.
UPDATE "appointments" SET "discount_value" = 0 WHERE "discount_value" < 0;--> statement-breakpoint
UPDATE "appointments" SET "discount_split_value" = 0 WHERE "discount_split_value" < 0;--> statement-breakpoint
UPDATE "appointment_procedures" SET "discount_value" = 0 WHERE "discount_value" < 0;--> statement-breakpoint
ALTER TABLE "appointment_procedures" ADD CONSTRAINT "appt_procedures_percent_discount_max" CHECK ("appointment_procedures"."discount_type" <> 'percent' or "appointment_procedures"."discount_value" between 0 and 100);--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_percent_discount_max" CHECK ("appointments"."discount_type" <> 'percent' or "appointments"."discount_value" between 0 and 100);--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_percent_split_max" CHECK ("appointments"."discount_split_type" <> 'percent' or "appointments"."discount_split_value" between 0 and 100);
