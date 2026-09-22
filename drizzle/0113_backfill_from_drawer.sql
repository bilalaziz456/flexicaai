-- Backfill `expenses.from_drawer` for spends recorded at the drawer BEFORE the column
-- existed (migration 0112, the same day).
--
-- WHY A BACKFILL IS OWED AT ALL. `from_drawer` decides whether the drawer history
-- lists a row, and a column added with `DEFAULT false` answers "no" for every row
-- already there. So the entries somebody typed at the drawer yesterday silently stop
-- being that page's own records — the owner found exactly this within minutes ("why
-- is paid out in cash reason tea not displaying"). Same shape as migration 0107 and
-- ADR-033's rule: a new field that gates visibility ships with its backfill, or it is
-- a silent revocation for precisely the people who used the feature.
--
-- THE EVIDENCE IS THE AUDIT LOG, NOT A HEURISTIC. Nothing on the expense row itself
-- distinguishes one typed at the drawer from one typed in Expenses — both are cash,
-- both can be uncategorised, both can have only a note. Guessing from those would flag
-- ordinary expenses and drag the expense ledger back onto a page the owner had just
-- asked to clear. But `submitCashSpend` writes a distinct audit line that the Expenses
-- form does not ('Added an expense (Rs n)'), and §12 keeps that trail, so the question
-- "where was this typed" has a recorded answer. Matching on it means this migration
-- marks a row only where the application said so at the time.
--
-- The join is deliberately tight: same clinic, the amount rendered exactly as the
-- action rendered it, and within five seconds of the INSERT (observed gap here: 13ms).
-- A false positive would need two cash expenses of the identical amount in one clinic
-- inside that window, and even then both were drawer spends, so both are right.
--
-- Idempotent — re-running matches nothing, since every row it touches is already true.
UPDATE "expenses" e
SET "from_drawer" = true
FROM "activity_logs" l
WHERE e."from_drawer" = false
  AND l."clinic_id" = e."clinic_id"
  AND l."summary" = 'Recorded a cash expense from petty cash (Rs ' || e."amount" || ')'
  AND abs(extract(epoch FROM (e."created_at" - l."created_at"))) < 5;
