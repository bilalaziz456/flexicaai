-- A NEW id, never a renumbering (ADR-027): `fee` takes 7 rather than slotting in
-- beside `price` where it belongs by meaning, because reordering would silently
-- reclassify rows already recorded.
INSERT INTO "chat_intents" ("id", "code", "label", "sort_order") VALUES
  (7, 'fee', 'Consultation fee question', 7)
ON CONFLICT ("id") DO NOTHING;
