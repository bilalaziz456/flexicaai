-- A third repeat interval for recurring expenses: Yearly (owner's ask, 2026-10-13) —
-- an annual licence, insurance premium or membership. Data only, like 0097/0098:
-- the vocabulary is a table, so a new value is a ROW. Id 3 is written out, never
-- assigned by a sequence, and must match `RECURRENCE_ROWS` in vocabulary-seed.ts
-- (scripts/test-vocabulary-tables.ts asserts the two agree). Idempotent.
INSERT INTO "recurrences" ("id", "code", "label", "sort_order", "is_active")
VALUES (3, 'yearly', 'Yearly', 3, true)
ON CONFLICT ("id") DO NOTHING;
