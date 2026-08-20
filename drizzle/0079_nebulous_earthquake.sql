-- Inbound WhatsApp idempotency (see schema.ts `wa_messages_inbound_external_id_unique`).
--
-- Any database that has been receiving webhooks may ALREADY hold replayed inbound
-- rows, and CREATE UNIQUE INDEX would fail on them. So first neutralise existing
-- duplicates: keep the earliest row of each group intact and clear `external_id` on
-- the later copies. Nothing is deleted — the message log stays complete, the
-- duplicates just stop competing for the id. (Delivery receipts correlate on
-- OUTBOUND rows, which this does not touch.)
UPDATE "whatsapp_messages" SET "external_id" = NULL
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id",
           row_number() OVER (
             PARTITION BY "external_id" ORDER BY "created_at", "id"
           ) AS rn
    FROM "whatsapp_messages"
    WHERE "external_id" IS NOT NULL AND "direction" = 'inbound'
  ) ranked
  WHERE rn > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX "wa_messages_inbound_external_id_unique" ON "whatsapp_messages" USING btree ("external_id") WHERE "whatsapp_messages"."external_id" is not null and "whatsapp_messages"."direction" = 'inbound';
