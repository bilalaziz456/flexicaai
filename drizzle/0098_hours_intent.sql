-- A NEW id, never a renumbering (ADR-027).
--
-- NOTE there is deliberately no clinic-level opening-hours COLUMN behind this. The
-- only hours in the system are per doctor (`users.availability`), and those are what
-- actually govern bookability. A separate clinic opening-hours field could say
-- "Sun 10–2" while no doctor works Sunday, so a patient would read it, try to book
-- and be refused — two sources of truth, one of which lies.
INSERT INTO "chat_intents" ("id", "code", "label", "sort_order") VALUES
  (8, 'hours', 'Timings question', 8)
ON CONFLICT ("id") DO NOTHING;
