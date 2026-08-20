import { NextResponse } from "next/server";
import { sweepClinicBillingStatus } from "@/core/admin/billing";
import { requireCron } from "@/core/security/cron";

/**
 * GET /api/cron/billing — daily sweep that recomputes every priced clinic's
 * billing health and flips `clinics.status` active↔past_due as time passes (the
 * time-based downgrade a payment event can't trigger; Feature 6 ↔ Feature 2).
 * Auth is the shared `requireCron` guard (Bearer <CRON_SECRET> or ?token=…).
 * sweepClinicBillingStatus opts out of the tenant guard (it spans all clinics).
 */
export async function GET(request: Request) {
  const denied = requireCron(request);
  if (denied) return denied;

  const result = await sweepClinicBillingStatus();
  return NextResponse.json({ ok: true, ...result });
}
