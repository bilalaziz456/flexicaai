-- Label wording, brought into line with what the UI already showed.
--
-- Converting the last components off their compiled label maps revealed the two had
-- already DRIFTED: the components said "Clinic waived (forgave debt)", "Doctor
-- repayment" and "Consent form" while the vocabulary tables said "Clinic waived
-- deficit", "Repayment" and "Consent". The component wording is the more specific of
-- the two, so it wins here rather than the conversion quietly regressing the text a
-- user reads.
--
-- Labels are data now, so this is an UPDATE, not a schema change. Mirrored in
-- src/core/db/vocabulary-seed.ts, which the start-up check compares against.
UPDATE "settlement_kinds" SET "label" = 'Clinic waived (forgave debt)' WHERE "code" = 'clinic_waive';--> statement-breakpoint
UPDATE "settlement_kinds" SET "label" = 'Doctor repayment' WHERE "code" = 'repayment';--> statement-breakpoint
UPDATE "attachment_kinds" SET "label" = 'Consent form' WHERE "code" = 'consent';
