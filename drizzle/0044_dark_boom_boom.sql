CREATE TABLE "dental_charts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"teeth" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dental_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"visit_id" uuid,
	"is_baseline" boolean DEFAULT false NOT NULL,
	"chief_complaint" text,
	"diagnosis" text,
	"findings" jsonb,
	"procedures_done" jsonb,
	"chart_after" jsonb,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_group" uuid,
	"deleted_by_cascade" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dental_charts" ADD CONSTRAINT "dental_charts_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dental_charts" ADD CONSTRAINT "dental_charts_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dental_records" ADD CONSTRAINT "dental_records_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dental_records" ADD CONSTRAINT "dental_records_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dental_records" ADD CONSTRAINT "dental_records_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dental_charts_patient_uq" ON "dental_charts" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "dental_charts_clinic_idx" ON "dental_charts" USING btree ("clinic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dental_records_visit_uq" ON "dental_records" USING btree ("visit_id") WHERE "dental_records"."visit_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "dental_records_baseline_uq" ON "dental_records" USING btree ("patient_id") WHERE "dental_records"."is_baseline" = true and "dental_records"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "dental_records_clinic_idx" ON "dental_records" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "dental_records_patient_idx" ON "dental_records" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "dental_records_deleted_idx" ON "dental_records" USING btree ("clinic_id","deleted_at") WHERE "dental_records"."deleted_at" is not null;