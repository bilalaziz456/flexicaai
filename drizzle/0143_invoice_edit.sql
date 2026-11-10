ALTER TABLE "clinic_invoices" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clinic_invoices" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "clinic_invoices" ADD COLUMN "updated_by_name" text;--> statement-breakpoint
-- Editing a subscription invoice (`sub_invoices:edit`, owner's call 2026-11-11).
-- ADMIN ACL backfill (ADR-033): a team member is a FULL super admin — and may manage
-- the team — only while they hold EVERY admin permission (canManageTeam), so a new
-- action would quietly demote each of them. One rule covers that and keeps what people
-- already do: whoever may ISSUE an invoice may correct one. Every full admin holds
-- `sub_invoices:create`, and so does the Billing preset.
UPDATE "users" u SET "permissions" = u."permissions" || ARRAY['sub_invoices:edit']
WHERE u."permissions" IS NOT NULL
  AND u."role" = (SELECT "id" FROM "user_roles" WHERE "code" = 'super_admin')
  AND 'sub_invoices:create' = ANY(u."permissions")
  AND NOT ('sub_invoices:edit' = ANY(u."permissions"));
