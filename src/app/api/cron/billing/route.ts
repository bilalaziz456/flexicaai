import { NextResponse } from "next/server";
import { sweepClinicBillingStatus } from "@/core/admin/billing";
import { runCron } from "@/core/security/cron";

/**
 * GET /api/cron/billing — daily sweep that recomputes every priced clinic's
 * billing health and flips `clinics.status` active↔past_due as time passes (the
 * time-based downgrade a payment event can't trigger; Feature 6 ↔ Feature 2).
 * Wrapped by `runCron`: auth (Bearer <CRON_SECRET> or ?token=…) + a correlation id +
 * crash reporting, since a cron has no user watching it.
 * sweepClinicBillingStatus opts out of the tenant guard (it spans all clinics).
 */
export async function GET(request: Request) {
  return runCron(request, "cron.billing", async () => {
    const result = await sweepClinicBillingStatus();
    return NextResponse.json({ ok: true, ...result });
  });
}
