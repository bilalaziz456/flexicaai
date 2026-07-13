DROP INDEX "users_username_unique";--> statement-breakpoint
DROP INDEX "users_email_unique";--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "delete_group" uuid;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "deleted_by_cascade" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "trash_retention_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "delete_group" uuid;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "deleted_by_cascade" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "doctor_leaves" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "doctor_leaves" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "doctor_leaves" ADD COLUMN "delete_group" uuid;--> statement-breakpoint
ALTER TABLE "doctor_leaves" ADD COLUMN "deleted_by_cascade" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "delete_group" uuid;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "deleted_by_cascade" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "procedures" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "procedures" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "procedures" ADD COLUMN "delete_group" uuid;--> statement-breakpoint
ALTER TABLE "procedures" ADD COLUMN "deleted_by_cascade" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "recalls" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recalls" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "recalls" ADD COLUMN "delete_group" uuid;--> statement-breakpoint
ALTER TABLE "recalls" ADD COLUMN "deleted_by_cascade" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "delete_group" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_by_cascade" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "delete_group" uuid;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "deleted_by_cascade" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "appointments_deleted_idx" ON "appointments" USING btree ("clinic_id","deleted_at") WHERE "appointments"."deleted_at" is not null;--> statement-breakpoint
CREATE INDEX "clinics_deleted_idx" ON "clinics" USING btree ("deleted_at") WHERE "clinics"."deleted_at" is not null;--> statement-breakpoint
CREATE INDEX "doctor_leaves_deleted_idx" ON "doctor_leaves" USING btree ("clinic_id","deleted_at") WHERE "doctor_leaves"."deleted_at" is not null;--> statement-breakpoint
CREATE INDEX "patients_deleted_idx" ON "patients" USING btree ("clinic_id","deleted_at") WHERE "patients"."deleted_at" is not null;--> statement-breakpoint
CREATE INDEX "procedures_deleted_idx" ON "procedures" USING btree ("clinic_id","deleted_at") WHERE "procedures"."deleted_at" is not null;--> statement-breakpoint
CREATE INDEX "recalls_deleted_idx" ON "recalls" USING btree ("clinic_id","deleted_at") WHERE "recalls"."deleted_at" is not null;--> statement-breakpoint
CREATE INDEX "users_deleted_idx" ON "users" USING btree ("clinic_id","deleted_at") WHERE "users"."deleted_at" is not null;--> statement-breakpoint
CREATE INDEX "visits_deleted_idx" ON "visits" USING btree ("clinic_id","deleted_at") WHERE "visits"."deleted_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_unique" ON "users" USING btree ("username") WHERE "users"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email") WHERE "users"."deleted_at" is null;