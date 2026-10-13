ALTER TABLE "appointment_procedures" ADD COLUMN "is_service" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "procedures" ADD COLUMN "is_service" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Services get their own ACL resource (`services:view/create/edit/delete`). ADR-033:
-- a new resource is a SILENT REVOCATION for a clinic whose capabilities the super
-- admin has scoped — the Services screen would simply be absent there. The closest
-- thing already stored is the procedures price list, so a scoped clinic gets the same
-- services actions it already has for procedures. NULL or '*' already means
-- "everything allowed". Users need no backfill: only the clinic admin holds services
-- by default, and a clinic admin's grants are all-permissions in code. Idempotent.
UPDATE "clinics"
   SET "capabilities" = "capabilities" || ARRAY['services:view']
 WHERE "capabilities" IS NOT NULL
   AND NOT ('*' = ANY("capabilities"))
   AND 'procedures:view' = ANY("capabilities")
   AND NOT ('services:view' = ANY("capabilities"));--> statement-breakpoint
UPDATE "clinics"
   SET "capabilities" = "capabilities" || ARRAY['services:create']
 WHERE "capabilities" IS NOT NULL
   AND NOT ('*' = ANY("capabilities"))
   AND 'procedures:create' = ANY("capabilities")
   AND NOT ('services:create' = ANY("capabilities"));--> statement-breakpoint
UPDATE "clinics"
   SET "capabilities" = "capabilities" || ARRAY['services:edit']
 WHERE "capabilities" IS NOT NULL
   AND NOT ('*' = ANY("capabilities"))
   AND 'procedures:edit' = ANY("capabilities")
   AND NOT ('services:edit' = ANY("capabilities"));--> statement-breakpoint
UPDATE "clinics"
   SET "capabilities" = "capabilities" || ARRAY['services:delete']
 WHERE "capabilities" IS NOT NULL
   AND NOT ('*' = ANY("capabilities"))
   AND 'procedures:delete' = ANY("capabilities")
   AND NOT ('services:delete' = ANY("capabilities"));
