-- Voice scribe gets its own permission, `scribe:create` (owner, 2026-11-14), split out
-- of `clinical:create`, which now means writing a note by hand. Until today
-- `clinical:create` meant only the scribe, so everyone who held it keeps recording:
-- each customised staff member (NULL = role defaults, which carry it themselves) and
-- each clinic whose capabilities are restricted (NULL = everything allowed).
UPDATE "users" SET "permissions" = array_append("permissions", 'scribe:create') WHERE "permissions" IS NOT NULL AND 'clinical:create' = ANY("permissions") AND NOT ('scribe:create' = ANY("permissions"));--> statement-breakpoint
UPDATE "clinics" SET "capabilities" = array_append("capabilities", 'scribe:create') WHERE "capabilities" IS NOT NULL AND 'clinical:create' = ANY("capabilities") AND NOT ('scribe:create' = ANY("capabilities"));
