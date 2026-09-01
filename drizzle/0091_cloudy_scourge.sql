-- Drops the seven enum TYPES, now that migration 0090 has moved every column that
-- used them onto an integer foreign key. Verified orphaned first: pg_attribute shows
-- zero columns of each type.
--
-- This is the point of no easy return for 0090 — recreating a type is trivial, but the
-- data would have to be mapped back from ids. 0090 left them standing precisely so
-- that step could be taken separately, after the conversion had been exercised.
--
-- The index rebuild at the top is drizzle-kit normalising the predicate it already
-- rewrote in 0090 (a fully qualified column name); it is a no-op in effect.
DROP INDEX "wa_messages_inbound_external_id_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "wa_messages_inbound_external_id_unique" ON "whatsapp_messages" USING btree ("external_id") WHERE "whatsapp_messages"."external_id" is not null and "whatsapp_messages"."direction" = 1;--> statement-breakpoint
DROP TYPE "public"."visit_status";--> statement-breakpoint
DROP TYPE "public"."theme_preference";--> statement-breakpoint
DROP TYPE "public"."user_role";--> statement-breakpoint
DROP TYPE "public"."appointment_status";--> statement-breakpoint
DROP TYPE "public"."recall_status";--> statement-breakpoint
DROP TYPE "public"."whatsapp_direction";--> statement-breakpoint
DROP TYPE "public"."whatsapp_status";