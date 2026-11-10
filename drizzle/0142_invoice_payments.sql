ALTER TABLE "clinic_invoices" ADD COLUMN "due_on" date;--> statement-breakpoint
ALTER TABLE "clinic_payments" ADD COLUMN "invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "clinic_payments" ADD CONSTRAINT "clinic_payments_invoice_id_clinic_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."clinic_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinic_payments_invoice_idx" ON "clinic_payments" USING btree ("invoice_id") WHERE "clinic_payments"."invoice_id" is not null;--> statement-breakpoint
-- Subscription invoices get a paid status (owner, 2026-11-11): a payment can now be
-- recorded against an invoice (clinic_payments.invoice_id), and an invoice not paid by
-- its due date shows as Overdue. Back-fill the due date of every invoice already
-- issued the way a new one gets it: the period start (or the issue day when there is
-- no period) plus the clinic's grace days. Existing payments stay unlinked — nothing
-- says which invoice they paid, so guessing would mark invoices paid that were not;
-- the billing card lets a person link them.
UPDATE "clinic_invoices" i
SET "due_on" = coalesce(i."period_start", i."issued_at"::date) + coalesce(c."grace_days", 0)
FROM "clinics" c
WHERE c."id" = i."clinic_id" AND i."due_on" IS NULL;
