ALTER TABLE "sale_shares" DROP CONSTRAINT "sale_shares_payout_id_doctor_payouts_id_fk";
--> statement-breakpoint
DROP INDEX "sale_shares_doctor_payout_idx";--> statement-breakpoint
ALTER TABLE "doctor_payouts" ADD COLUMN "method" text;--> statement-breakpoint
ALTER TABLE "doctor_payouts" ADD COLUMN "reference" text;--> statement-breakpoint
CREATE INDEX "sale_shares_clinic_doctor_idx" ON "sale_shares" USING btree ("clinic_id","doctor_id");--> statement-breakpoint
ALTER TABLE "sale_shares" DROP COLUMN "payout_id";