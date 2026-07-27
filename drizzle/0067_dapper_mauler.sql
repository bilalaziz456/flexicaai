CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"filename" text,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "opening_balance" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "procedures" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_batches_clinic_idx" ON "import_batches" USING btree ("clinic_id","created_at");--> statement-breakpoint
CREATE INDEX "patients_clinic_external_ref_idx" ON "patients" USING btree ("clinic_id","external_ref") WHERE "patients"."external_ref" is not null;