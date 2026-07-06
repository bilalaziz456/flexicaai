ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username" text;--> statement-breakpoint
UPDATE "users" SET "username" = lower(split_part("email", '@', 1)) WHERE "username" IS NULL AND "email" IS NOT NULL;--> statement-breakpoint
UPDATE "users" SET "username" = 'user_' || substr("id"::text, 1, 8) WHERE "username" IS NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_unique" ON "users" USING btree ("username");
