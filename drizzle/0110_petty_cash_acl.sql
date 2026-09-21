-- Petty cash gets its own ACL resource (`cash:view` / `cash:create`). Nothing in the
-- schema changes; what changes is the meaning of two stored arrays.
--
-- ADR-033: a new resource is a SILENT REVOCATION for anyone whose permissions were
-- ever customised. `can()` is a set-membership test, and an array written before a
-- slug existed cannot contain it — so the screen is simply absent, with no error, for
-- exactly the clinics that cared enough to configure their access.
--
-- 0107 could preserve what each user already had, because `schedule` came OUT of
-- `leave` and the predecessor was obvious. There is no predecessor here: petty cash is
-- new. So the rule is "who would the role defaults give this to", expressed as the
-- closest thing already stored — **whoever takes money at the desk**:
--
--   billing:create  →  cash:view + cash:create
--
-- That is the front desk and the manager, which is exactly who ROLE_DEFAULTS now
-- grants it to. Somebody who can collect a payment can count the box the notes went
-- into; somebody who cannot has no reason to.
--
-- A user on the role defaults (permissions IS NULL) is deliberately untouched and
-- picks the new grant up from code. Every statement is idempotent.

-- Tier 2 — per-user permissions.
UPDATE "users"
   SET "permissions" = "permissions" || ARRAY['cash:view']
 WHERE "permissions" IS NOT NULL
   AND 'billing:create' = ANY("permissions")
   AND NOT ('cash:view' = ANY("permissions"));--> statement-breakpoint

UPDATE "users"
   SET "permissions" = "permissions" || ARRAY['cash:create']
 WHERE "permissions" IS NOT NULL
   AND 'billing:create' = ANY("permissions")
   AND NOT ('cash:create' = ANY("permissions"));--> statement-breakpoint

-- Tier 1 — the super admin's per-clinic capability whitelist. NULL or '*' already
-- means "everything allowed", so only an explicitly scoped clinic needs widening;
-- without this the whole clinic loses the screen however its users are configured.
UPDATE "clinics"
   SET "capabilities" = "capabilities" || ARRAY['cash:view']
 WHERE "capabilities" IS NOT NULL
   AND NOT ('*' = ANY("capabilities"))
   AND 'billing:create' = ANY("capabilities")
   AND NOT ('cash:view' = ANY("capabilities"));--> statement-breakpoint

UPDATE "clinics"
   SET "capabilities" = "capabilities" || ARRAY['cash:create']
 WHERE "capabilities" IS NOT NULL
   AND NOT ('*' = ANY("capabilities"))
   AND 'billing:create' = ANY("capabilities")
   AND NOT ('cash:create' = ANY("capabilities"));
