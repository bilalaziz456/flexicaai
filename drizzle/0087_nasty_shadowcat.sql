-- Money-path vocabularies become REFERENCE TABLES, and the 16 columns carrying them
-- gain an integer foreign key (owner's direction, 2026-09-02). Real referential
-- integrity in place of the CHECK constraints from migration 0084.
--
-- IDS ARE WRITTEN OUT, NEVER ASSIGNED BY A SEQUENCE. A surrogate key only means
-- anything if the same number means the same thing in every environment. A `serial`
-- assigns by insertion order, so a re-seed in a different order would silently
-- reclassify money already recorded — a refund becoming a payment moves a P&L and
-- raises nothing. The literal ids below are mirrored in `src/core/db/vocabulary-seed.ts`
-- and `scripts/test-vocabulary-tables.ts` asserts the two agree, row for row.
--
-- ORDER MATTERS. The id columns are added NULLABLE, backfilled from the text column
-- that is still present, and only then set NOT NULL. Adding them NOT NULL outright —
-- what drizzle-kit generates — fails immediately on any table that has rows.
--
-- A row whose text value is not in its lookup table leaves a NULL, and the SET NOT NULL
-- below then FAILS. That is deliberate: there is no safe automatic mapping for an
-- unrecognised money vocabulary, so the migration stops rather than guessing (the same
-- reasoning as 0084's pre-flight).
--
-- The text columns are KEPT for now. They are dropped only once every read and write
-- uses the id, so this step stays reversible and the two can be proven to agree first.
--> statement-breakpoint
CREATE TABLE "approval_statuses" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "approval_statuses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "clinic_payment_kinds" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "clinic_payment_kinds_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "discount_bearers" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "discount_bearers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "discount_statuses" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "discount_statuses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "discount_types" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "discount_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "payment_kinds" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "payment_kinds_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_tender" boolean DEFAULT true NOT NULL,
	CONSTRAINT "payment_methods_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "settlement_kinds" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "settlement_kinds_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "settlement_parties" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "settlement_parties_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE INDEX "payment_methods_tender_idx" ON "payment_methods" USING btree ("is_tender");
--> statement-breakpoint
-- Seed: explicit ids, mirrored in src/core/db/vocabulary-seed.ts
--> statement-breakpoint
INSERT INTO "payment_kinds" ("id", "code", "label", "sort_order") VALUES
  (1, 'payment', 'Payment', 1),
  (2, 'advance', 'Advance', 2),
  (3, 'advance_applied', 'Advance applied', 3),
  (4, 'refund', 'Refund', 4),
  (5, 'opening', 'Opening balance payment', 5)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "clinic_payment_kinds" ("id", "code", "label", "sort_order") VALUES
  (1, 'payment', 'Payment', 1),
  (2, 'refund', 'Refund', 2),
  (3, 'credit', 'Credit', 3)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "payment_methods" ("id", "code", "label", "sort_order", "is_tender") VALUES
  (1, 'cash', 'Cash', 1, true),
  (2, 'bank', 'Bank transfer', 2, true),
  (3, 'cheque', 'Cheque', 3, true),
  (4, 'other', 'Other', 4, true),
  (5, 'advance', 'Advance credit', 5, false)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "settlement_kinds" ("id", "code", "label", "sort_order") VALUES
  (1, 'doctor_waive', 'Doctor waived own share', 1),
  (2, 'clinic_waive', 'Clinic waived deficit', 2),
  (3, 'repayment', 'Repayment', 3),
  (4, 'write_off', 'Debt written off', 4),
  (5, 'reversal', 'Reversal', 5)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "settlement_parties" ("id", "code", "label", "sort_order") VALUES
  (1, 'clinic', 'Clinic', 1),
  (2, 'doctor', 'Doctor', 2)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "approval_statuses" ("id", "code", "label", "sort_order") VALUES
  (1, 'pending', 'Pending', 1),
  (2, 'approved', 'Approved', 2),
  (3, 'rejected', 'Rejected', 3)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "discount_statuses" ("id", "code", "label", "sort_order") VALUES
  (1, 'none', 'No approval needed', 1),
  (2, 'pending', 'Pending approval', 2),
  (3, 'approved', 'Approved', 3),
  (4, 'rejected', 'Rejected', 4)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "discount_types" ("id", "code", "label", "sort_order") VALUES
  (1, 'amount', 'Flat amount', 1),
  (2, 'percent', 'Percentage', 2)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "discount_bearers" ("id", "code", "label", "sort_order") VALUES
  (1, 'clinic', 'Clinic', 1),
  (2, 'doctor', 'Doctor', 2),
  (3, 'split', 'Split', 3)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- Added NULLABLE so the backfill below can populate them
--> statement-breakpoint
ALTER TABLE "appointment_discount_approvals" ADD COLUMN "approver_kind_id" integer;
--> statement-breakpoint
ALTER TABLE "appointment_discount_approvals" ADD COLUMN "status_id" integer;
--> statement-breakpoint
ALTER TABLE "appointment_procedures" ADD COLUMN "discount_type_id" integer;
--> statement-breakpoint
ALTER TABLE "discount_settlements" ADD COLUMN "party_id" integer;
--> statement-breakpoint
ALTER TABLE "doctor_payouts" ADD COLUMN "method_id" integer;
--> statement-breakpoint
ALTER TABLE "doctor_settlement_actions" ADD COLUMN "kind_id" integer;
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "method_id" integer;
--> statement-breakpoint
ALTER TABLE "patient_payments" ADD COLUMN "kind_id" integer;
--> statement-breakpoint
ALTER TABLE "patient_payments" ADD COLUMN "method_id" integer;
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "discount_type_id" integer;
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "discount_borne_by_id" integer;
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "discount_status_id" integer;
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "discount_split_type_id" integer;
--> statement-breakpoint
ALTER TABLE "clinic_payments" ADD COLUMN "kind_id" integer;
--> statement-breakpoint
ALTER TABLE "clinic_payments" ADD COLUMN "method_id" integer;
--> statement-breakpoint
ALTER TABLE "company_expenses" ADD COLUMN "method_id" integer;
--> statement-breakpoint
-- Backfill from the text column, which is still present
--> statement-breakpoint
UPDATE "patient_payments" t SET "kind_id" = v."id" FROM "payment_kinds" v WHERE v."code" = t."kind";
--> statement-breakpoint
UPDATE "patient_payments" t SET "method_id" = v."id" FROM "payment_methods" v WHERE v."code" = t."method";
--> statement-breakpoint
UPDATE "clinic_payments" t SET "kind_id" = v."id" FROM "clinic_payment_kinds" v WHERE v."code" = t."kind";
--> statement-breakpoint
UPDATE "clinic_payments" t SET "method_id" = v."id" FROM "payment_methods" v WHERE v."code" = t."method";
--> statement-breakpoint
UPDATE "doctor_payouts" t SET "method_id" = v."id" FROM "payment_methods" v WHERE v."code" = t."method";
--> statement-breakpoint
UPDATE "expenses" t SET "method_id" = v."id" FROM "payment_methods" v WHERE v."code" = t."method";
--> statement-breakpoint
UPDATE "company_expenses" t SET "method_id" = v."id" FROM "payment_methods" v WHERE v."code" = t."method";
--> statement-breakpoint
UPDATE "doctor_settlement_actions" t SET "kind_id" = v."id" FROM "settlement_kinds" v WHERE v."code" = t."kind";
--> statement-breakpoint
UPDATE "discount_settlements" t SET "party_id" = v."id" FROM "settlement_parties" v WHERE v."code" = t."party";
--> statement-breakpoint
UPDATE "appointment_discount_approvals" t SET "approver_kind_id" = v."id" FROM "settlement_parties" v WHERE v."code" = t."approver_kind";
--> statement-breakpoint
UPDATE "appointment_discount_approvals" t SET "status_id" = v."id" FROM "approval_statuses" v WHERE v."code" = t."status";
--> statement-breakpoint
UPDATE "appointment_procedures" t SET "discount_type_id" = v."id" FROM "discount_types" v WHERE v."code" = t."discount_type";
--> statement-breakpoint
UPDATE "appointments" t SET "discount_type_id" = v."id" FROM "discount_types" v WHERE v."code" = t."discount_type";
--> statement-breakpoint
UPDATE "appointments" t SET "discount_split_type_id" = v."id" FROM "discount_types" v WHERE v."code" = t."discount_split_type";
--> statement-breakpoint
UPDATE "appointments" t SET "discount_borne_by_id" = v."id" FROM "discount_bearers" v WHERE v."code" = t."discount_borne_by";
--> statement-breakpoint
UPDATE "appointments" t SET "discount_status_id" = v."id" FROM "discount_statuses" v WHERE v."code" = t."discount_status";
--> statement-breakpoint
-- Every row now has a value; enforce it
--> statement-breakpoint
ALTER TABLE "patient_payments" ALTER COLUMN "kind_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "clinic_payments" ALTER COLUMN "kind_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "doctor_settlement_actions" ALTER COLUMN "kind_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "discount_settlements" ALTER COLUMN "party_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "appointment_discount_approvals" ALTER COLUMN "approver_kind_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "appointment_discount_approvals" ALTER COLUMN "status_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "appointment_procedures" ALTER COLUMN "discount_type_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "discount_type_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "discount_split_type_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "discount_borne_by_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "discount_status_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "appointment_discount_approvals" ADD CONSTRAINT "appointment_discount_approvals_approver_kind_id_settlement_parties_id_fk" FOREIGN KEY ("approver_kind_id") REFERENCES "public"."settlement_parties"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointment_discount_approvals" ADD CONSTRAINT "appointment_discount_approvals_status_id_approval_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."approval_statuses"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointment_procedures" ADD CONSTRAINT "appointment_procedures_discount_type_id_discount_types_id_fk" FOREIGN KEY ("discount_type_id") REFERENCES "public"."discount_types"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "discount_settlements" ADD CONSTRAINT "discount_settlements_party_id_settlement_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."settlement_parties"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "doctor_payouts" ADD CONSTRAINT "doctor_payouts_method_id_payment_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."payment_methods"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "doctor_settlement_actions" ADD CONSTRAINT "doctor_settlement_actions_kind_id_settlement_kinds_id_fk" FOREIGN KEY ("kind_id") REFERENCES "public"."settlement_kinds"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_method_id_payment_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."payment_methods"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "patient_payments" ADD CONSTRAINT "patient_payments_kind_id_payment_kinds_id_fk" FOREIGN KEY ("kind_id") REFERENCES "public"."payment_kinds"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "patient_payments" ADD CONSTRAINT "patient_payments_method_id_payment_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."payment_methods"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_discount_type_id_discount_types_id_fk" FOREIGN KEY ("discount_type_id") REFERENCES "public"."discount_types"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_discount_borne_by_id_discount_bearers_id_fk" FOREIGN KEY ("discount_borne_by_id") REFERENCES "public"."discount_bearers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_discount_status_id_discount_statuses_id_fk" FOREIGN KEY ("discount_status_id") REFERENCES "public"."discount_statuses"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_discount_split_type_id_discount_types_id_fk" FOREIGN KEY ("discount_split_type_id") REFERENCES "public"."discount_types"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "clinic_payments" ADD CONSTRAINT "clinic_payments_kind_id_clinic_payment_kinds_id_fk" FOREIGN KEY ("kind_id") REFERENCES "public"."clinic_payment_kinds"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "clinic_payments" ADD CONSTRAINT "clinic_payments_method_id_payment_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."payment_methods"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "company_expenses" ADD CONSTRAINT "company_expenses_method_id_payment_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."payment_methods"("id") ON DELETE no action ON UPDATE no action;
