-- A clinic's default for who bears a NEW patient discount (owner, 2026-11-11):
-- clinic (1, as before), doctor (2) or split (3). A split's doctor part is that
-- doctor's own share % on the line, so no percentage is stored. Set by the clinic
-- admin in Settings; only a starting choice.
-- drizzle-kit writes the vocabulary default as its code; the column holds the id.
ALTER TABLE "clinics" ADD COLUMN "default_discount_borne_by_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_default_discount_borne_by_id_discount_bearers_id_fk" FOREIGN KEY ("default_discount_borne_by_id") REFERENCES "public"."discount_bearers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_default_bearer_not_proportional" CHECK ("clinics"."default_discount_borne_by_id" <> 4);