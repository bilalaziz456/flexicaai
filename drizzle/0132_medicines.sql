CREATE TABLE "clinic_medicines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" text NOT NULL,
	"brands" text[] DEFAULT '{}'::text[] NOT NULL,
	"form" text,
	"strength" text,
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
CREATE TABLE "medicines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"brands" text[] DEFAULT '{}'::text[] NOT NULL,
	"form" text,
	"strength" text,
	"specialties" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clinic_medicines" ADD CONSTRAINT "clinic_medicines_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clinic_medicines_name_unique" ON "clinic_medicines" USING btree ("clinic_id",lower("name")) WHERE "clinic_medicines"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "clinic_medicines_deleted_idx" ON "clinic_medicines" USING btree ("clinic_id","deleted_at") WHERE "clinic_medicines"."deleted_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "medicines_name_unique" ON "medicines" USING btree (lower("name"));--> statement-breakpoint
-- The starting master list: the dental formulary's medicines, tagged "dental" so a
-- dental clinic sees them first. The super admin grows it from /admin/medicines.
INSERT INTO "medicines" ("name", "brands", "form", "strength", "specialties") VALUES
  ('Amoxicillin', '{Amoxil,Moxin,Amoclav}', 'capsule', '500 mg', '{dental}'),
  ('Amoxicillin + Clavulanic acid', '{Augmentin,Calamox,Amoclan}', 'tablet', '625 mg', '{dental}'),
  ('Metronidazole', '{Flagyl,Metrozine}', 'tablet', '400 mg', '{dental}'),
  ('Clindamycin', '{"Dalacin C",Clindac}', 'capsule', '300 mg', '{dental}'),
  ('Ibuprofen', '{Brufen,Ibugesic}', 'tablet', '400 mg', '{dental}'),
  ('Paracetamol', '{Panadol,Calpol}', 'tablet', '500 mg', '{dental}'),
  ('Mefenamic acid', '{Ponstan,Mefnac}', 'tablet', '500 mg', '{dental}'),
  ('Diclofenac sodium', '{Dicloran,Voltral}', 'tablet', '50 mg', '{dental}'),
  ('Chlorhexidine gluconate', '{Orahex,Rebisol}', 'mouthwash', '0.2%', '{dental}')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- ADMIN ACL backfill (ADR-033). A team member counts as a FULL super admin — and may
-- manage the team — only while they hold EVERY admin permission (canManageTeam). A
-- new resource would quietly demote each of them to "custom", so anyone who holds all
-- 33 permissions that existed before this migration is given the new four too.
UPDATE "users" u SET "permissions" = u."permissions" || ARRAY['medicines:view','medicines:create','medicines:edit','medicines:delete']
WHERE u."permissions" IS NOT NULL
  AND u."role" = (SELECT "id" FROM "user_roles" WHERE "code" = 'super_admin')
  AND u."permissions" @> ARRAY[
    'clinics:view','clinics:create','clinics:edit','clinics:delete','import:create',
    'billing:view','billing:create','billing:edit','billing:delete',
    'announcements:view','announcements:create','announcements:edit','announcements:delete',
    'account:view','account:edit','team:view','team:create','team:edit','team:delete',
    'impersonate:view','metrics:view','revenue:view','pnl:view',
    'serving_cost:view','serving_cost:edit',
    'expenses:view','expenses:create','expenses:edit','expenses:delete',
    'sub_invoices:view','sub_invoices:create','sub_invoices:delete','purge:delete'
  ]::text[]
  AND NOT ('medicines:view' = ANY(u."permissions"));
--> statement-breakpoint
-- CLINIC capability backfill (ADR-033, like 0125's services). A clinic the super
-- admin has scoped holds only the slugs listed, so the new `medicines` resource would
-- be missing for every one of them. Follow prescriptions: a clinic that may view
-- prescriptions may view its medicines; one that may write them may manage them.
UPDATE "clinics" c SET "capabilities" = c."capabilities" || ARRAY['medicines:view']
WHERE c."capabilities" IS NOT NULL AND NOT ('*' = ANY(c."capabilities"))
  AND 'prescriptions:view' = ANY(c."capabilities")
  AND NOT ('medicines:view' = ANY(c."capabilities"));
--> statement-breakpoint
UPDATE "clinics" c SET "capabilities" = c."capabilities" || ARRAY['medicines:create','medicines:edit','medicines:delete']
WHERE c."capabilities" IS NOT NULL AND NOT ('*' = ANY(c."capabilities"))
  AND 'prescriptions:create' = ANY(c."capabilities")
  AND NOT ('medicines:create' = ANY(c."capabilities"));
