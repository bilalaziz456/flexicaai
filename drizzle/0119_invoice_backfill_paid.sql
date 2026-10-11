-- Every payment is held against an invoice number (owner's call, 2026-10-12).
-- Visits that took money BEFORE invoices were numbered automatically (0118) have none,
-- so their payments showed "—" in the Invoice # column. This numbers them once.
--
-- Rules, each about not breaking the sequence:
--  * Only visits with a live payment row, no live invoice, in a clinic with the
--    `sales` feature (the same gate as the app).
--  * Numbers CONTINUE this year's sequence: from the higher of the clinic's counter
--    and the highest number already issued this year — never reusing one.
--  * Ordered by the visit's first payment, so the oldest paid visit gets the lowest.
--  * A cancelled (6) / no-show (7) visit's invoice is born VOID, as 0118 does.
--  * Idempotent: a second run finds nothing left to number.
WITH yr AS (
  SELECT extract(year FROM now())::int AS y
),
need AS (
  SELECT a.id AS appointment_id, a.clinic_id, a.patient_id, a.status,
         row_number() OVER (PARTITION BY a.clinic_id ORDER BY min(pp.occurred_at), a.id) AS rn
  FROM appointments a
  JOIN patient_payments pp ON pp.appointment_id = a.id AND pp.deleted_at IS NULL
  JOIN clinics c ON c.id = a.clinic_id
  WHERE a.deleted_at IS NULL
    AND 'sales' = ANY (c.features_enabled)
    AND NOT EXISTS (
      SELECT 1 FROM invoices i WHERE i.appointment_id = a.id AND i.deleted_at IS NULL
    )
  GROUP BY a.id, a.clinic_id, a.patient_id, a.status
),
base AS (
  SELECT c.id AS clinic_id,
         GREATEST(
           CASE WHEN c.invoice_year = (SELECT y FROM yr) THEN c.next_invoice_no - 1 ELSE 0 END,
           coalesce((SELECT max(i.invoice_no) FROM invoices i
                     WHERE i.clinic_id = c.id AND i.invoice_year = (SELECT y FROM yr)), 0)
         ) AS last_no
  FROM clinics c
  WHERE c.id IN (SELECT clinic_id FROM need)
),
ins AS (
  INSERT INTO invoices (clinic_id, appointment_id, patient_id, invoice_no, invoice_year,
                        issued_by_name, voided_at, void_reason)
  SELECT n.clinic_id, n.appointment_id, n.patient_id, b.last_no + n.rn, (SELECT y FROM yr),
         'Automatic',
         CASE WHEN n.status IN (6, 7) THEN now() END,
         CASE n.status WHEN 6 THEN 'Cancelled' WHEN 7 THEN 'No-show' END
  FROM need n JOIN base b ON b.clinic_id = n.clinic_id
  RETURNING clinic_id, invoice_no
)
UPDATE clinics c
SET next_invoice_no = m.max_no + 1,
    invoice_year = (SELECT y FROM yr),
    updated_at = now()
FROM (SELECT clinic_id, max(invoice_no) AS max_no FROM ins GROUP BY clinic_id) m
WHERE c.id = m.clinic_id;
