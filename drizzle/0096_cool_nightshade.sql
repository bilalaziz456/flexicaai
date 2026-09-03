CREATE TABLE "chat_intents" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "chat_intents_code_unique" UNIQUE("code")
);
--> statement-breakpoint
-- Ids are WRITTEN OUT, never assigned by a sequence (ADR-027). A serial assigns by
-- insertion order, so a re-seed in a different order would silently reclassify rows
-- already recorded. `scripts/test-vocabulary-tables.ts` asserts this matches
-- `src/core/db/vocabulary-seed.ts` row for row.
INSERT INTO "chat_intents" ("id", "code", "label", "sort_order") VALUES
  (1, 'book', 'Booking', 1),
  (2, 'reschedule', 'Reschedule', 2),
  (3, 'cancel', 'Cancellation', 3),
  (4, 'price', 'Price question', 4),
  (5, 'clinical', 'Clinical question', 5),
  (6, 'other', 'Other', 6)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD COLUMN "intent_id" integer;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_intent_id_chat_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."chat_intents"("id") ON DELETE no action ON UPDATE no action;