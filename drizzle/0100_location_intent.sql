-- A NEW id, never a renumbering (ADR-027).
INSERT INTO "chat_intents" ("id", "code", "label", "sort_order") VALUES
  (9, 'location', 'Location question', 9)
ON CONFLICT ("id") DO NOTHING;
