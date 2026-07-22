CREATE TABLE "company_expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid,
	"amount" integer DEFAULT 0 NOT NULL,
	"incurred_on" date NOT NULL,
	"vendor" text,
	"method" text,
	"reference" text,
	"note" text,
	"recurring" boolean DEFAULT false NOT NULL,
	"recurrence" text,
	"next_run_on" date,
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
ALTER TABLE "company_expenses" ADD CONSTRAINT "company_expenses_category_id_company_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."company_expense_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_expenses_incurred_idx" ON "company_expenses" USING btree ("incurred_on");--> statement-breakpoint
CREATE INDEX "company_expenses_category_idx" ON "company_expenses" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "company_expenses_deleted_idx" ON "company_expenses" USING btree ("deleted_at") WHERE "company_expenses"."deleted_at" is not null;--> statement-breakpoint
CREATE INDEX "company_expenses_recurring_due_idx" ON "company_expenses" USING btree ("next_run_on") WHERE "company_expenses"."recurring" = true and "company_expenses"."deleted_at" is null;