CREATE TABLE "clinic_price_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"clinic_id" uuid NOT NULL,
	"price" integer NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clinic_price_changes" ADD CONSTRAINT "clinic_price_changes_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinic_price_changes_clinic_from_idx" ON "clinic_price_changes" USING btree ("clinic_id","effective_from");
--> statement-breakpoint
INSERT INTO "clinic_price_changes" ("clinic_id", "price", "effective_from", "created_by_name")
SELECT id, monthly_price, coalesce(activated_at, created_at), 'backfill'
  FROM "clinics"
 WHERE monthly_price > 0;
