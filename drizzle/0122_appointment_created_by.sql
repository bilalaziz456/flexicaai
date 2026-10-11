ALTER TABLE "appointments" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "created_by_name" text;--> statement-breakpoint
-- Who created each EXISTING staff booking, from the activity log: its "create" row
-- on that appointment carries the actor's id and name (a snapshot, so a since-renamed
-- or removed member still reads correctly). The earliest such row wins. A patient's
-- WhatsApp self-booking is left NULL — its `source` already says who made it — and so
-- is any appointment the log has no create row for (shown as "—", never guessed).
-- Idempotent: only fills rows still NULL.
UPDATE "appointments" a
SET "created_by" = l."actor_user_id",
    "created_by_name" = l."actor_name"
FROM (
  SELECT DISTINCT ON ("entity_id") "entity_id", "actor_user_id", "actor_name"
  FROM "activity_logs"
  WHERE "entity" = 'appointment'
    AND "action" = 'create'
    AND "actor_user_id" IS NOT NULL
  ORDER BY "entity_id", "created_at"
) l
WHERE a."id" = l."entity_id"
  AND a."created_by_name" IS NULL
  AND a."source" = (SELECT "id" FROM "appointment_sources" WHERE "code" = 'staff');
