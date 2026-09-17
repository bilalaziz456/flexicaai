-- Doctor SCHEDULE is its own ACL resource now, split out of `leave` (ADR-033).
-- Nothing in the schema changes; what changes is the meaning of two stored arrays,
-- so anyone who was ALREADY allowed to see the rota or set a daily cap has to keep
-- that access. A new resource is otherwise a silent revocation: `can()` is a set
-- membership test, and a stored array simply will not contain a slug that did not
-- exist when it was written.
--
-- The rule is "preserve what they could do", not "apply the new defaults":
--   leave:view  → schedule:view   (they could already open the leave screen)
--   leave:edit  → schedule:edit   (they could already set a doctor's daily cap)
-- A user on the ROLE DEFAULTS (permissions IS NULL) is untouched here and picks up
-- the new defaults from code — which is where the front desk loses cap-editing, on
-- purpose. A clinic that wants it back grants `schedule:edit` to that user.

-- Tier 2 — per-user permissions (NULL = role defaults, left alone).
UPDATE "users"
   SET "permissions" = "permissions" || ARRAY['schedule:view']
 WHERE "permissions" IS NOT NULL
   AND 'leave:view' = ANY("permissions")
   AND NOT ('schedule:view' = ANY("permissions"));--> statement-breakpoint

UPDATE "users"
   SET "permissions" = "permissions" || ARRAY['schedule:edit']
 WHERE "permissions" IS NOT NULL
   AND 'leave:edit' = ANY("permissions")
   AND NOT ('schedule:edit' = ANY("permissions"));--> statement-breakpoint

-- Tier 1 — the super admin's per-clinic capability whitelist. NULL or '*' already
-- means "everything allowed", so only an explicitly scoped clinic needs widening;
-- without this the whole clinic loses the schedule screen however its users are set.
UPDATE "clinics"
   SET "capabilities" = "capabilities" || ARRAY['schedule:view']
 WHERE "capabilities" IS NOT NULL
   AND NOT ('*' = ANY("capabilities"))
   AND 'leave:view' = ANY("capabilities")
   AND NOT ('schedule:view' = ANY("capabilities"));--> statement-breakpoint

UPDATE "clinics"
   SET "capabilities" = "capabilities" || ARRAY['schedule:edit']
 WHERE "capabilities" IS NOT NULL
   AND NOT ('*' = ANY("capabilities"))
   AND 'leave:edit' = ANY("capabilities")
   AND NOT ('schedule:edit' = ANY("capabilities"));
