CREATE TABLE "imported_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"type" text NOT NULL,
	"txn_date" date,
	"amount" integer DEFAULT 0 NOT NULL,
	"patient_id" uuid,
	"patient_name" text,
	"external_patient_ref" text,
	"doctor_id" uuid,
	"doctor_name" text,
	"description" text,
	"reference" text,
	"method" text,
	"raw" jsonb,
	"import_batch_id" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_group" uuid,
	"deleted_by_cascade" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "imported_transactions" ADD CONSTRAINT "imported_transactions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imported_transactions" ADD CONSTRAINT "imported_transactions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imported_transactions" ADD CONSTRAINT "imported_transactions_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "imported_txn_clinic_type_date_idx" ON "imported_transactions" USING btree ("clinic_id","type","txn_date");--> statement-breakpoint
CREATE INDEX "imported_txn_patient_idx" ON "imported_transactions" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "imported_txn_doctor_idx" ON "imported_transactions" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "imported_txn_batch_idx" ON "imported_transactions" USING btree ("import_batch_id");--> statement-breakpoint
CREATE INDEX "imported_txn_patient_trgm_idx" ON "imported_transactions" USING gin ("patient_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "imported_txn_doctor_trgm_idx" ON "imported_transactions" USING gin ("doctor_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "imported_txn_reference_idx" ON "imported_transactions" USING btree ("clinic_id","reference");--> statement-breakpoint
CREATE INDEX "imported_txn_deleted_idx" ON "imported_transactions" USING btree ("clinic_id","deleted_at") WHERE "imported_transactions"."deleted_at" is not null;