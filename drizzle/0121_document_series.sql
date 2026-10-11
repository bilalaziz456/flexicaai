DROP INDEX "invoices_clinic_year_no_unique";--> statement-breakpoint
DROP INDEX "appointments_receipt_unique";--> statement-breakpoint
-- Invoice and receipt numbers become ONE running series per clinic that never resets:
-- INV-100001, INV-100002 … and RCP-100001 … (owner's call, 2026-10-12). They used to
-- restart every January as INV-2026-0000001.
--
-- EXISTING NUMBERS ARE RENUMBERED — the owner's decision, safe only because there are
-- no live clinics yet (test data only). Never repeat this once real patients hold
-- printed invoices: a document number is an identity, like an MRN (see 0115).
--
-- Order is preserved: within a clinic, the oldest invoice (by year, then old number)
-- becomes 100001. Soft-deleted rows are numbered too, because the new unique index
-- covers them and a restore must not collide. The old per-year indexes are dropped
-- above first, so the renumbering cannot trip over them half way.
UPDATE "invoices" i
SET "invoice_no" = 100000 + n.rn
FROM (
  SELECT "id", row_number() OVER (
    PARTITION BY "clinic_id"
    ORDER BY coalesce("invoice_year", extract(year FROM "issued_at")::int), "invoice_no", "issued_at", "id"
  ) AS rn
  FROM "invoices"
) n
WHERE i."id" = n."id";--> statement-breakpoint
UPDATE "appointments" a
SET "receipt_no" = 100000 + n.rn
FROM (
  SELECT "id", row_number() OVER (
    PARTITION BY "clinic_id"
    ORDER BY coalesce("receipt_year", 0), "receipt_no", "id"
  ) AS rn
  FROM "appointments"
  WHERE "receipt_no" IS NOT NULL
) n
WHERE a."id" = n."id";--> statement-breakpoint
-- Each clinic's counters continue after its highest number (or start at 100001).
UPDATE "clinics" c
SET "next_invoice_no" = coalesce((SELECT max("invoice_no") FROM "invoices" WHERE "clinic_id" = c."id"), 100000) + 1,
    "next_receipt_no" = coalesce((SELECT max("receipt_no") FROM "appointments" WHERE "clinic_id" = c."id"), 100000) + 1;--> statement-breakpoint
ALTER TABLE "clinics" ALTER COLUMN "next_invoice_no" SET DEFAULT 100001;--> statement-breakpoint
ALTER TABLE "clinics" ALTER COLUMN "next_receipt_no" SET DEFAULT 100001;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_clinic_no_unique" ON "invoices" USING btree ("clinic_id","invoice_no");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_receipt_unique" ON "appointments" USING btree ("clinic_id","receipt_no") WHERE "appointments"."receipt_no" is not null;