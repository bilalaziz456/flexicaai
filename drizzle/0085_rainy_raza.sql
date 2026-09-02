-- Corrects `patient_payments_method_valid` from migration 0084, which was too narrow.
--
-- 0084 constrained the column to the four TENDERS a receptionist can choose. But
-- `applyAdvance` (core/billing/payments.ts) settles a bill from a patient's stored
-- credit and records `method = 'advance'` — a system marker, not a tender: no money
-- changed hands, so it is deliberately absent from the dropdowns. The constraint
-- therefore rejected a legitimate, existing write path.
--
-- WHY THE AUDIT MISSED IT, worth remembering before adding the next constraint: the
-- pre-flight ran `SELECT DISTINCT` over existing DATA and found nothing outside the
-- set — but no advance had ever been applied on that database, so the value simply
-- was not there to find. Auditing rows proves what has been written; it says nothing
-- about what the CODE can write. Grep the write paths as well.
ALTER TABLE "patient_payments" DROP CONSTRAINT "patient_payments_method_valid";--> statement-breakpoint
ALTER TABLE "patient_payments" ADD CONSTRAINT "patient_payments_method_valid" CHECK ("patient_payments"."method" in ('cash', 'bank', 'cheque', 'other', 'advance'));