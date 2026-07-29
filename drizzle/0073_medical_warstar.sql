ALTER TABLE "appointments" ADD COLUMN "receipt_no" integer;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "receipt_year" integer;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "receipt_prefix" text DEFAULT 'RCP-' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "next_receipt_no" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "receipt_year" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_receipt_unique" ON "appointments" USING btree ("clinic_id","receipt_year","receipt_no") WHERE "appointments"."receipt_no" is not null;--> statement-breakpoint
UPDATE "appointments" a SET receipt_no = n.rn, receipt_year = n.yr FROM (
  SELECT id, yr, row_number() OVER (PARTITION BY clinic_id, yr ORDER BY first_pay, id) AS rn FROM (
    SELECT a.id, a.clinic_id, extract(year from min(pp.occurred_at))::int AS yr, min(pp.occurred_at) AS first_pay
    FROM "appointments" a
    JOIN "patient_payments" pp ON pp.appointment_id = a.id AND pp.deleted_at IS NULL AND pp.kind IN ('payment','advance_applied')
    WHERE a.receipt_no IS NULL AND a.deleted_at IS NULL
    GROUP BY a.id, a.clinic_id
  ) paid
) n WHERE a.id = n.id;--> statement-breakpoint
UPDATE "clinics" c SET next_receipt_no = COALESCE(m.mx,0)+1, receipt_year = m.yr FROM (
  SELECT clinic_id, max(receipt_no) AS mx, max(receipt_year) AS yr FROM "appointments" WHERE receipt_no IS NOT NULL GROUP BY clinic_id
) m WHERE c.id = m.clinic_id;
