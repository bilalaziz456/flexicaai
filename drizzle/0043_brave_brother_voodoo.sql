ALTER TABLE "expenses" ADD COLUMN "recurrence" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "next_run_on" date;--> statement-breakpoint
CREATE INDEX "expenses_recurring_due_idx" ON "expenses" USING btree ("next_run_on") WHERE "expenses"."recurring" = true and "expenses"."deleted_at" is null;