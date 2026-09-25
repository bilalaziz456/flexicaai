-- Idle session timeout, and the column it is measured from.
--
-- `sessions.last_seen_at` is NOT a duplicate of `expires_at`. That one is an ABSOLUTE
-- ceiling — no session outlives seven days, whatever happens. This one answers a
-- different question: has anybody actually been at this terminal recently? A shared
-- reception machine left logged in overnight is the case it exists for.
--
-- DEFAULT now() ON EXISTING ROWS IS THE POINT, not an accident of the generator.
-- Backfilling NULL, or an epoch, would mean every session already open is instantly
-- idle-expired the moment somebody sets a window — a deploy that signs the whole
-- company out. Every live session starts its idle clock at the migration instead.
ALTER TABLE "sessions" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- 0 = never time out, and that is the default deliberately (the same reasoning as
-- `activity_log_retention_days`, ADR-023): an idle timeout trades security against
-- interruption, and where that line falls depends on the room. The machinery ships
-- inert and does nothing until the owner chooses a window.
ALTER TABLE "company_settings" ADD COLUMN "session_idle_minutes" integer DEFAULT 0 NOT NULL;
