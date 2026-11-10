ALTER TABLE "company_settings" ALTER COLUMN "invoice_prefix" SET DEFAULT 'FA-INV-';--> statement-breakpoint
-- Subscription invoices are numbered FA-INV-1, FA-INV-2 … (owner, 2026-11-11). The old
-- "KL-INV-" was the column default, never a choice anyone made (there is no screen to
-- set it), so the stored row moves with it. The label is prefix + number at read time,
-- so invoices already issued read FA-INV-n from now on; the numbers do not change.
UPDATE "company_settings" SET "invoice_prefix" = 'FA-INV-' WHERE "invoice_prefix" = 'KL-INV-';
