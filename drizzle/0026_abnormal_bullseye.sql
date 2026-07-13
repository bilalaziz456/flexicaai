ALTER TYPE "public"."user_role" ADD VALUE 'manager' BEFORE 'doctor';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "permissions" text[];