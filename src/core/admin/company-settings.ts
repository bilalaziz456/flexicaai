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
  const [row] = await db.select({ id: companySettings.id }).from(companySettings).limit(1);
  if (row) {
    await db.update(companySettings).set({ churnInactiveDays: d, updatedAt: new Date() }).where(eq(companySettings.id, row.id));
  } else {
    await db.insert(companySettings).values({ churnInactiveDays: d });
  }
}
