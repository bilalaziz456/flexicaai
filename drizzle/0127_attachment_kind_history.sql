-- A new attachment kind for medical-history documents (another doctor's letter, a
-- prescription listing the patient's medicines, a lab report). A NEW id, never a
-- renumbering (ADR-027). Data-only.
INSERT INTO "attachment_kinds" ("id", "code", "label", "sort_order") VALUES
  (5, 'history', 'Medical history', 5)
ON CONFLICT ("id") DO NOTHING;
