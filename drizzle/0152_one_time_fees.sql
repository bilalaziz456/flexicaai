CREATE TABLE "clinic_fees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"description" text,
	"amount" integer NOT NULL,
	"charged_on" date NOT NULL,
	"created_by" uuid,
	"created_by_name" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_group" uuid,
	"deleted_by_cascade" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clinic_invoices" ADD COLUMN "fee_lines" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_invoices" ADD COLUMN "fee_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_payments" ADD COLUMN "fee_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_fees" ADD CONSTRAINT "clinic_fees_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinic_fees_clinic_idx" ON "clinic_fees" USING btree ("clinic_id","charged_on");--> statement-breakpoint
CREATE INDEX "clinic_fees_deleted_idx" ON "clinic_fees" USING btree ("deleted_at") WHERE "clinic_fees"."deleted_at" is not null;--> statement-breakpoint
-- One-time fees (owner, 2026-11-17): a new admin resource, `fees` (view/create/delete).
-- ADMIN ACL backfill (ADR-033): a team member is a FULL super admin — and may manage
-- the team — only while they hold EVERY admin permission (canManageTeam), so a new
-- resource would quietly demote each of them. Whoever may SEE a clinic's billing may
-- see and add its fees (account managers of every preset hold billing:view); whoever
-- may issue invoices may also remove one. Every full admin holds both.
UPDATE "users" u SET "permissions" = u."permissions" || ARRAY['fees:view','fees:create']
WHERE u."permissions" IS NOT NULL
  AND u."role" = (SELECT "id" FROM "user_roles" WHERE "code" = 'super_admin')
  AND 'billing:view' = ANY(u."permissions")
  AND NOT ('fees:view' = ANY(u."permissions"));
--> statement-breakpoint
UPDATE "users" u SET "permissions" = u."permissions" || ARRAY['fees:delete']
WHERE u."permissions" IS NOT NULL
  AND u."role" = (SELECT "id" FROM "user_roles" WHERE "code" = 'super_admin')
  AND 'sub_invoices:create' = ANY(u."permissions")
  AND NOT ('fees:delete' = ANY(u."permissions"));
