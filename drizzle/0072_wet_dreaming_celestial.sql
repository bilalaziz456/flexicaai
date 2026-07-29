DROP INDEX "invoices_clinic_no_unique";--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "invoice_year" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "invoice_year" integer;--> statement-breakpoint
UPDATE "invoices" SET "invoice_year" = extract(year from "issued_at")::int WHERE "invoice_year" IS NULL;--> statement-breakpoint
UPDATE "clinics" SET "invoice_year" = sub.max_year FROM (SELECT "clinic_id", max(extract(year from "issued_at")::int) AS max_year FROM "invoices" GROUP BY "clinic_id") sub WHERE "clinics"."id" = sub."clinic_id" AND "clinics"."invoice_year" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_clinic_year_no_unique" ON "invoices" USING btree ("clinic_id","invoice_year","invoice_no");
