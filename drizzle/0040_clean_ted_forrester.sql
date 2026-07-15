CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"category_id" uuid,
	"amount" integer DEFAULT 0 NOT NULL,
	"incurred_on" date NOT NULL,
	"vendor" text,
	"method" text,
	"reference" text,
	"note" text,
	"recurring" boolean DEFAULT false NOT NULL,
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
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_categories_clinic_idx" ON "expense_categories" USING btree ("clinic_id","is_active");--> statement-breakpoint
CREATE INDEX "expenses_clinic_incurred_idx" ON "expenses" USING btree ("clinic_id","incurred_on");--> statement-breakpoint
CREATE INDEX "expenses_clinic_category_idx" ON "expenses" USING btree ("clinic_id","category_id");--> statement-breakpoint
CREATE INDEX "expenses_deleted_idx" ON "expenses" USING btree ("clinic_id","deleted_at") WHERE "expenses"."deleted_at" is not null;