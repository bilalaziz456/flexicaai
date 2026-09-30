-- Account manager contact — the clinic is told who looks after it, and how to reach them.
--
-- Four additive, nullable columns. Nothing is rewritten, so this is safe to run on a
-- database with real data in it.

-- When a clinic's CURRENT account-manager assignment began.
--
-- DELIBERATELY NOT BACKFILLED, and that is the decision worth recording here. Every
-- clinic that already has a manager gets NULL. Filling it with `updated_at` or `now()`
-- would date an assignment that did not just happen, and the clinic-side notice is
-- driven off this column — so every clinic in the product would be told "your account
-- manager is now X" about a manager who had not changed. Announcing a change that did
-- not occur is worse than staying silent about one that did: the whole value of the
-- notice is that it can be trusted.
--
-- `assigned_to SET` + `assigned_at NULL` is therefore a legitimate third state meaning
-- "assigned before this column existed". `getAccountManagerContact` still resolves the
-- contact for those clinics — only the 14-day notice needs a real date, and it stays
-- quiet without one.
ALTER TABLE "clinics" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint

-- A TEAM MEMBER's contact number, shown to the clinics they manage. Stored E.164, the
-- same canonical form as `patients.phone` (core/lib/phone.ts).
--
-- NULLABLE deliberately, even though the form requires it: `ADD COLUMN … NOT NULL`
-- with no default fails outright on a table that already has rows (ADR-027), and there
-- is no phone number that could honestly be defaulted in. Existing members get theirs
-- when somebody next edits them; until then the clinic is shown the company number
-- rather than a name sitting above a blank line.
ALTER TABLE "users" ADD COLUMN "phone" text;--> statement-breakpoint

-- The company's own contact details — the fallback shown to a clinic with no account
-- manager, which is the common case early on. A row update rather than a constant, so
-- the number can change without a deploy (the same reasoning as every other value on
-- `company_settings`).
ALTER TABLE "company_settings" ADD COLUMN "support_phone" text;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "support_email" text;
