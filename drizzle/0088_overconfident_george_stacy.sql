-- Mirror each text column's DEFAULT onto its id column, using the seeded id from
-- migration 0087. Without these, every insert that relied on the text default would
-- now have to name the id explicitly — including paths that never mention a discount.
ALTER TABLE "appointment_discount_approvals" ALTER COLUMN "status_id" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "appointment_procedures" ALTER COLUMN "discount_type_id" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "discount_type_id" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "discount_borne_by_id" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "discount_status_id" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "discount_split_type_id" SET DEFAULT 2;--> statement-breakpoint
ALTER TABLE "clinic_payments" ALTER COLUMN "kind_id" SET DEFAULT 1;