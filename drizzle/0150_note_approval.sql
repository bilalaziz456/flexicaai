ALTER TABLE "visits" ADD COLUMN "treating_doctor_id" uuid;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notes_need_approval" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_treating_doctor_id_users_id_fk" FOREIGN KEY ("treating_doctor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- A note written by someone other than the patient's doctor waits for that doctor, who
-- may send it back to its author (owner, 2026-11-14).
INSERT INTO "visit_statuses" ("id", "code", "label", "sort_order") VALUES
  (5, 'pending_approval', 'Waiting for approval', 5),
  (6, 'returned', 'Sent back', 6)
ON CONFLICT ("id") DO NOTHING;
