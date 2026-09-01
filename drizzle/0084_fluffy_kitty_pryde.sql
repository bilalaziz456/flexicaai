-- Vocabulary CHECK constraints on the MONEY-PATH columns.
--
-- WHY these columns and not every text column in the schema: each value below is a
-- branch that money arithmetic takes, and every consumer of them falls back to a
-- default rather than raising. `plActionEffect` (core/finance/pl.ts) returns 0 for an
-- unrecognised settlement kind; `aggregateCash` (core/finance/daybook.ts) ignores a
-- payment kind it doesn't know; the bill treats any discount_type that isn't
-- 'percent' as a flat amount. So a bad value here does not fail — it produces a wrong
-- figure, quietly, in a report someone reconciles against a cash drawer. Columns whose
-- worst case is a wrong badge colour or paper size are deliberately left unconstrained.
--
-- Every write path already validates (zod at each action, plus the shared const arrays
-- in core/*). This makes the invariant true regardless of which writer is used — a
-- backfill, a script, or psql on the server.
--
-- NOTE ON NULLS: a CHECK is satisfied when its expression is true OR null, so the
-- nullable `method` columns still accept an unset value without an explicit branch.
--
-- Unlike migration 0080, which CLAMPED out-of-range numbers before adding its
-- constraints, this migration deliberately does NOT rewrite anything. There is no safe
-- automatic mapping for an unknown vocabulary value: silently reclassifying a money row
-- (say, an unrecognised kind into 'payment') would change ledger figures and P&L
-- output without anyone asking. So it fails loudly instead, naming the table, column
-- and offending values, and leaves the decision to a human.
DO $$
DECLARE
  r record;
  n bigint;
  offenders text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('patient_payments','kind',ARRAY['payment','advance','advance_applied','refund','opening']),
      ('patient_payments','method',ARRAY['cash','bank','cheque','other']),
      ('clinic_payments','kind',ARRAY['payment','refund','credit']),
      ('clinic_payments','method',ARRAY['cash','bank','cheque','other']),
      ('doctor_payouts','method',ARRAY['cash','bank','cheque','other']),
      ('expenses','method',ARRAY['cash','bank','cheque','other']),
      ('company_expenses','method',ARRAY['cash','bank','cheque','other']),
      ('doctor_settlement_actions','kind',ARRAY['doctor_waive','clinic_waive','repayment','write_off','reversal']),
      ('discount_settlements','party',ARRAY['clinic','doctor']),
      ('appointment_discount_approvals','approver_kind',ARRAY['clinic','doctor']),
      ('appointment_discount_approvals','status',ARRAY['pending','approved','rejected']),
      ('appointment_procedures','discount_type',ARRAY['amount','percent']),
      ('appointments','discount_type',ARRAY['amount','percent']),
      ('appointments','discount_split_type',ARRAY['amount','percent']),
      ('appointments','discount_borne_by',ARRAY['clinic','doctor','split']),
      ('appointments','discount_status',ARRAY['none','pending','approved','rejected'])
    ) AS v(tbl, col, allowed)
  LOOP
    EXECUTE format(
      'SELECT count(*), string_agg(DISTINCT quote_literal(v), '', '') FROM (SELECT %I::text AS v FROM %I WHERE %I IS NOT NULL AND NOT (%I::text = ANY($1))) s',
      r.col, r.tbl, r.col, r.col
    ) INTO n, offenders USING r.allowed;
    IF n > 0 THEN
      RAISE EXCEPTION 'Cannot constrain %.%: % row(s) hold a value outside the allowed set (%)', r.tbl, r.col, n, offenders
        USING HINT = 'Inspect and correct those rows, then re-run. Values are NOT auto-mapped on purpose: reclassifying a money row would silently change ledger and P&L figures.';
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE "appointment_discount_approvals" ADD CONSTRAINT "appt_discount_approvals_kind_valid" CHECK ("appointment_discount_approvals"."approver_kind" in ('clinic', 'doctor'));--> statement-breakpoint
ALTER TABLE "appointment_discount_approvals" ADD CONSTRAINT "appt_discount_approvals_status_valid" CHECK ("appointment_discount_approvals"."status" in ('pending', 'approved', 'rejected'));--> statement-breakpoint
ALTER TABLE "appointment_procedures" ADD CONSTRAINT "appt_procedures_discount_type_valid" CHECK ("appointment_procedures"."discount_type" in ('amount', 'percent'));--> statement-breakpoint
ALTER TABLE "discount_settlements" ADD CONSTRAINT "discount_settlements_party_valid" CHECK ("discount_settlements"."party" in ('clinic', 'doctor'));--> statement-breakpoint
ALTER TABLE "doctor_payouts" ADD CONSTRAINT "doctor_payouts_method_valid" CHECK ("doctor_payouts"."method" in ('cash', 'bank', 'cheque', 'other'));--> statement-breakpoint
ALTER TABLE "doctor_settlement_actions" ADD CONSTRAINT "doctor_settlement_actions_kind_valid" CHECK ("doctor_settlement_actions"."kind" in ('doctor_waive', 'clinic_waive', 'repayment', 'write_off', 'reversal'));--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_method_valid" CHECK ("expenses"."method" in ('cash', 'bank', 'cheque', 'other'));--> statement-breakpoint
ALTER TABLE "patient_payments" ADD CONSTRAINT "patient_payments_kind_valid" CHECK ("patient_payments"."kind" in ('payment', 'advance', 'advance_applied', 'refund', 'opening'));--> statement-breakpoint
ALTER TABLE "patient_payments" ADD CONSTRAINT "patient_payments_method_valid" CHECK ("patient_payments"."method" in ('cash', 'bank', 'cheque', 'other'));--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_discount_type_valid" CHECK ("appointments"."discount_type" in ('amount', 'percent'));--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_discount_split_type_valid" CHECK ("appointments"."discount_split_type" in ('amount', 'percent'));--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_discount_borne_by_valid" CHECK ("appointments"."discount_borne_by" in ('clinic', 'doctor', 'split'));--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_discount_status_valid" CHECK ("appointments"."discount_status" in ('none', 'pending', 'approved', 'rejected'));--> statement-breakpoint
ALTER TABLE "clinic_payments" ADD CONSTRAINT "clinic_payments_kind_valid" CHECK ("clinic_payments"."kind" in ('payment', 'refund', 'credit'));--> statement-breakpoint
ALTER TABLE "clinic_payments" ADD CONSTRAINT "clinic_payments_method_valid" CHECK ("clinic_payments"."method" in ('cash', 'bank', 'cheque', 'other'));--> statement-breakpoint
ALTER TABLE "company_expenses" ADD CONSTRAINT "company_expenses_method_valid" CHECK ("company_expenses"."method" in ('cash', 'bank', 'cheque', 'other'));