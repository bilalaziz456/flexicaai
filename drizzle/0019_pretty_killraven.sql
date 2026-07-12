CREATE TABLE "activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid,
	"actor_user_id" uuid,
	"actor_name" text NOT NULL,
	"actor_role" text,
	"action" text NOT NULL,
	"entity" text,
	"entity_id" uuid,
	"summary" text NOT NULL,
	"metadata" jsonb,
	"visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_logs_clinic_visible_idx" ON "activity_logs" USING btree ("clinic_id","visible","created_at");--> statement-breakpoint
CREATE INDEX "activity_logs_clinic_created_idx" ON "activity_logs" USING btree ("clinic_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_logs_visible_scan_idx" ON "activity_logs" USING btree ("visible","created_at");--> statement-breakpoint
CREATE INDEX "activity_logs_actor_idx" ON "activity_logs" USING btree ("actor_user_id");