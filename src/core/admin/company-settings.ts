import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { companySettings } from "@/core/db/schema";

/**
 * Company-wide settings (Owner) — the singleton `company_settings` row. CORE, not a
 * tenant table. Currently exposes the Overview churn threshold default; the invoice
 * counter lives alongside it (see core/admin/clinic-invoices.ts).
 */

/** Allowed churn-threshold values (days a live clinic can be quiet before at-risk). */
export const CHURN_DAYS_OPTIONS = [7, 14, 21, 30, 45, 60, 90] as const;
export const DEFAULT_CHURN_DAYS = 21;

/** The persisted company default churn threshold (falls back to 21). */
export async function getChurnInactiveDays(): Promise<number> {
  const [row] = await db.select({ d: companySettings.churnInactiveDays }).from(companySettings).limit(1);
  return row ? row.d : DEFAULT_CHURN_DAYS;
}

/** Saves the company default churn threshold (validated, seeds the row if missing). */
export async function setChurnInactiveDays(days: number): Promise<void> {
  const d = (CHURN_DAYS_OPTIONS as readonly number[]).includes(days) ? days : DEFAULT_CHURN_DAYS;
  await upsertSettings({ churnInactiveDays: d });
}

/** Usage/cost anomaly-flag thresholds (Overview). */
export type AnomalyThresholds = {
  thinMarginPct: number; // serving cost ≥ this % of MRR → "High cost"
  spikeMultiple: number; // serving cost ≥ this × the prior period → "Usage spike"
  spikeFloorPkr: number; // ignore absolute costs below this (a 0→30 jump isn't a spike)
};
export const DEFAULT_ANOMALY: AnomalyThresholds = { thinMarginPct: 50, spikeMultiple: 3, spikeFloorPkr: 200 };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

/** The persisted anomaly thresholds (falls back to the defaults). */
export async function getAnomalyThresholds(): Promise<AnomalyThresholds> {
  const [row] = await db
    .select({ p: companySettings.thinMarginPct, m: companySettings.spikeMultiple, f: companySettings.spikeFloorPkr })
    .from(companySettings)
    .limit(1);
  if (!row) return DEFAULT_ANOMALY;
  return { thinMarginPct: row.p, spikeMultiple: row.m, spikeFloorPkr: row.f };
}

/** Saves the anomaly thresholds (clamped to sane bounds; seeds the row if missing). */
export async function setAnomalyThresholds(t: AnomalyThresholds): Promise<void> {
  await upsertSettings({
    thinMarginPct: clamp(t.thinMarginPct, 1, 100),
    spikeMultiple: clamp(t.spikeMultiple, 2, 100),
    spikeFloorPkr: clamp(t.spikeFloorPkr, 0, 10_000_000),
  });
}

/** Update the singleton settings row, seeding it if it doesn't exist yet. */
async function upsertSettings(patch: Partial<typeof companySettings.$inferInsert>): Promise<void> {
  const [row] = await db.select({ id: companySettings.id }).from(companySettings).limit(1);
  if (row) {
    await db.update(companySettings).set({ ...patch, updatedAt: new Date() }).where(eq(companySettings.id, row.id));
  } else {
    await db.insert(companySettings).values(patch);
  }
}
