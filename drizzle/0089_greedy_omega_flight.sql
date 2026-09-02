-- Drops the text columns now that every read and write goes through the id (the
-- "contract" half of the expand-migrate-contract begun in 0087), and with them the
-- CHECK constraints of 0084/0085 — the foreign key subsumes them.
--
-- HAND-CORRECTED: drizzle-kit rendered each `.default("pending")` etc. literally,
-- because it does not run a custom column type's `toDriver` when generating DDL. That
-- would set a TEXT default on an INTEGER column. The 7 defaults below are the
-- seeded ids from 0087; they must stay in step with `src/core/db/vocabulary-seed.ts`.
ALTER TABLE "appointment_discount_approvals" DROP CONSTRAINT "appt_discount_approvals_kind_valid";--> statement-breakpoint
ALTER TABLE "appointment_discount_approvals" DROP CONSTRAINT "appt_discount_approvals_status_valid";--> statement-breakpoint
ALTER TABLE "appointment_procedures" DROP CONSTRAINT "appt_procedures_discount_type_valid";--> statement-breakpoint
ALTER TABLE "appointment_procedures" DROP CONSTRAINT "appt_procedures_percent_discount_max";--> statement-breakpoint
ALTER TABLE "discount_settlements" DROP CONSTRAINT "discount_settlements_party_valid";--> statement-breakpoint
ALTER TABLE "doctor_payouts" DROP CONSTRAINT "doctor_payouts_method_valid";--> statement-breakpoint
ALTER TABLE "doctor_settlement_actions" DROP CONSTRAINT "doctor_settlement_actions_kind_valid";--> statement-breakpoint
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_method_valid";--> statement-breakpoint
ALTER TABLE "patient_payments" DROP CONSTRAINT "patient_payments_kind_valid";--> statement-breakpoint
ALTER TABLE "patient_payments" DROP CONSTRAINT "patient_payments_method_valid";--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_discount_type_valid";--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_discount_split_type_valid";--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_discount_borne_by_valid";--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_discount_status_valid";--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_percent_discount_max";--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_percent_split_max";--> statement-breakpoint
ALTER TABLE "clinic_payments" DROP CONSTRAINT "clinic_payments_kind_valid";--> statement-breakpoint
ALTER TABLE "clinic_payments" DROP CONSTRAINT "clinic_payments_method_valid";--> statement-breakpoint
ALTER TABLE "company_expenses" DROP CONSTRAINT "company_expenses_method_valid";--> statement-breakpoint
DROP INDEX "appt_discount_approvals_clinic_status_idx";--> statement-breakpoint
DROP INDEX "appt_discount_approvals_doctor_status_idx";--> statement-breakpoint
DROP INDEX "doctor_settlement_actions_line_waive_uniq";--> statement-breakpoint
ALTER TABLE "appointment_discount_approvals" ALTER COLUMN "status_id" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "appointment_procedures" ALTER COLUMN "discount_type_id" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "discount_type_id" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "discount_borne_by_id" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "discount_status_id" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "discount_split_type_id" SET DEFAULT 2;--> statement-breakpoint
ALTER TABLE "clinic_payments" ALTER COLUMN "kind_id" SET DEFAULT 1;--> statement-breakpoint
CREATE INDEX "appt_discount_approvals_clinic_status_idx" ON "appointment_discount_approvals" USING btree ("clinic_id","status_id");--> statement-breakpoint
CREATE INDEX "appt_discount_approvals_doctor_status_idx" ON "appointment_discount_approvals" USING btree ("approver_doctor_id","status_id");--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_settlement_actions_line_waive_uniq" ON "doctor_settlement_actions" USING btree ("appointment_id","line_ref") WHERE "doctor_settlement_actions"."kind_id" = 1 and "doctor_settlement_actions"."line_ref" is not null and "doctor_settlement_actions"."appointment_id" is not null;--> statement-breakpoint
ALTER TABLE "appointment_discount_approvals" DROP COLUMN "approver_kind";--> statement-breakpoint
ALTER TABLE "appointment_discount_approvals" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "appointment_procedures" DROP COLUMN "discount_type";--> statement-breakpoint
ALTER TABLE "discount_settlements" DROP COLUMN "party";--> statement-breakpoint
ALTER TABLE "doctor_payouts" DROP COLUMN "method";--> statement-breakpoint
ALTER TABLE "doctor_settlement_actions" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "expenses" DROP COLUMN "method";--> statement-breakpoint
ALTER TABLE "patient_payments" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "patient_payments" DROP COLUMN "method";--> statement-breakpoint
ALTER TABLE "appointments" DROP COLUMN "discount_type";--> statement-breakpoint
ALTER TABLE "appointments" DROP COLUMN "discount_borne_by";--> statement-breakpoint
ALTER TABLE "appointments" DROP COLUMN "discount_status";--> statement-breakpoint
ALTER TABLE "appointments" DROP COLUMN "discount_split_type";--> statement-breakpoint
ALTER TABLE "clinic_payments" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "clinic_payments" DROP COLUMN "method";--> statement-breakpoint
ALTER TABLE "company_expenses" DROP COLUMN "method";--> statement-breakpoint
ALTER TABLE "appointment_procedures" ADD CONSTRAINT "appt_procedures_percent_discount_max" CHECK ("appointment_procedures"."discount_type_id" <> 2 or "appointment_procedures"."discount_value" between 0 and 100);--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_percent_discount_max" CHECK ("appointments"."discount_type_id" <> 2 or "appointments"."discount_value" between 0 and 100);--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_percent_split_max" CHECK ("appointments"."discount_split_type_id" <> 2 or "appointments"."discount_split_value" between 0 and 100);