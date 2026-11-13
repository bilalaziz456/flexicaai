-- Voice scribe becomes a per-clinic feature the super admin / account manager can
-- switch off (owner, 2026-11-14). Every clinic had it until now, so every clinic keeps
-- it: nothing changes until someone unticks it. New clinics start with it
-- (DEFAULT_CLINIC_FEATURES in core/lib/features.ts).
UPDATE "clinics" SET "features_enabled" = array_append("features_enabled", 'voice_scribe') WHERE NOT ('voice_scribe' = ANY("features_enabled"));
