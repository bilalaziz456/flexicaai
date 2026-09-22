CREATE TABLE "cash_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"counted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"counted_total" integer NOT NULL,
	"expected_total" integer,
	"variance" integer,
	"note" text,
	"counted_by" uuid,
	"counted_by_name" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_group" uuid,
	"deleted_by_cascade" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"kind_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reference" text,
	"note" text,
	"created_by" uuid,
	"created_by_name" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_group" uuid,
	"deleted_by_cascade" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_transfer_kinds" (
	"id" integer PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "cash_transfer_kinds_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "cash_counts" ADD CONSTRAINT "cash_counts_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_kind_id_cash_transfer_kinds_id_fk" FOREIGN KEY ("kind_id") REFERENCES "public"."cash_transfer_kinds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_counts_clinic_at_idx" ON "cash_counts" USING btree ("clinic_id","counted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cash_counts_deleted_idx" ON "cash_counts" USING btree ("clinic_id","deleted_at") WHERE "cash_counts"."deleted_at" is not null;--> statement-breakpoint
CREATE INDEX "cash_transfers_clinic_at_idx" ON "cash_transfers" USING btree ("clinic_id","occurred_at");--> statement-breakpoint
CREATE INDEX "cash_transfers_deleted_idx" ON "cash_transfers" USING btree ("clinic_id","deleted_at") WHERE "cash_transfers"."deleted_at" is not null;--> statement-breakpoint
-- Seed the vocabulary. drizzle-kit creates the lookup table and the foreign key but
-- never the ROWS, so without this the table is empty and the first cash transfer
-- fails its FK. Ids are written out and never renumbered (ADR-027) — they must mean
-- the same thing in dev, staging and production, and `vocabulary-seed.ts` holds the
-- identical list so `scripts/test-vocabulary-tables.ts` can assert the two agree.
INSERT INTO "cash_transfer_kinds" ("id", "code", "label", "sort_order", "is_active") VALUES
  (1, 'bank_deposit', 'Banked', 1, true),
  (2, 'owner_draw', 'Taken by owner', 2, true),
  (3, 'float_topup', 'Float added', 3, true)
ON CONFLICT ("id") DO NOTHING;
