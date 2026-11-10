ALTER TABLE "company_settings" ADD COLUMN "province_tax" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- Starting values only, from public guides as of 2026-11 — the owner confirms them with
-- a tax adviser and edits them on /admin/finance/invoices. KP, Balochistan and AJK are
-- the weakest (older or single sources; owner chose to fill them, 2026-11-11). GB is
-- left out — sources disagree whether it taxes services at all — so it uses the
-- company default until a rate is typed for it.
UPDATE "company_settings" SET "province_tax" = '{"punjab":{"label":"Sales tax (PRA)","rate":5},"sindh":{"label":"Sales tax (SRB)","rate":3},"ict":{"label":"Sales tax (FBR)","rate":5},"kpk":{"label":"Sales tax (KPRA)","rate":5},"balochistan":{"label":"Sales tax (BRA)","rate":6},"ajk":{"label":"Sales tax (AJK)","rate":5}}'::jsonb WHERE "province_tax" = '{}'::jsonb;
