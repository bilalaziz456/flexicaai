-- Give every existing patient an MRN.
--
-- `patients.mrn` has been nullable only so the column could be added and backfilled
-- later (its schema comment says exactly that). Later is now: the money screens search
-- by MRN, and a patient with none is unfindable by the number printed on their card.
--
-- THREE RULES, and each of them is about NOT BREAKING AN IDENTITY.
--
-- 1. An MRN already assigned is never touched. It may be on a card in somebody's
--    wallet, so it is identity, not data — the same reason ADR-027 writes vocabulary
--    ids out by hand and never renumbers them. Only NULLs are filled.
--
-- 2. Numbering continues from `GREATEST(max assigned, next_mrn - 1)`, not from the
--    highest MRN in the table. A clinic here has `next_mrn = 5` with no MRNs assigned
--    at all: the counter has already issued 1–4 to patients that have since been
--    removed. Starting at 1 would hand those numbers to somebody else, which is REUSE
--    — the one outcome worse than a gap. Gaps in an MRN sequence cost nothing.
--
-- 3. Order is registration order (`created_at`, then `id` to break ties
--    deterministically), so the first patient a clinic registered gets the lowest
--    number. Any other order would be arbitrary, and this sequence is the one thing
--    an MRN communicates besides identity.
--
-- SOFT-DELETED PATIENTS ARE NUMBERED TOO. `patients_clinic_mrn_idx` is unique on
-- (clinic_id, mrn) WHERE mrn IS NOT NULL — it does NOT exclude deleted rows — so a
-- trashed patient still occupies its slot. Skipping them would leave a restore free
-- to collide with a number since given to somebody else.
--
-- Idempotent: a second run finds no NULLs and assigns nothing.
WITH start AS (
  SELECT c.id AS clinic_id,
         GREATEST(COALESCE(MAX(p.mrn), 0), c.next_mrn - 1) AS from_mrn
  FROM clinics c
  LEFT JOIN patients p ON p.clinic_id = c.id
  GROUP BY c.id, c.next_mrn
),
numbered AS (
  SELECT p.id,
         s.from_mrn + ROW_NUMBER() OVER (
           PARTITION BY p.clinic_id ORDER BY p.created_at, p.id
         ) AS new_mrn
  FROM patients p
  JOIN start s ON s.clinic_id = p.clinic_id
  WHERE p.mrn IS NULL
)
UPDATE patients SET mrn = numbered.new_mrn
FROM numbered
WHERE patients.id = numbered.id;--> statement-breakpoint
-- Move each clinic's counter past everything now assigned, or the next real
-- registration collides with a number this migration just handed out. Runs for EVERY
-- clinic, not only backfilled ones: a counter left behind its own patients is the
-- same bug whether this migration caused it or found it.
UPDATE clinics c
SET next_mrn = GREATEST(
  c.next_mrn,
  COALESCE((SELECT MAX(p.mrn) FROM patients p WHERE p.clinic_id = c.id), 0) + 1
);
