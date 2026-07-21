import { NextResponse } from "next/server";
import { sweepClinicBillingStatus } from "@/core/admin/billing";
import { serverEnv, isProduction } from "@/core/lib/env";

/**
 * GET /api/cron/billing — daily sweep that recomputes every priced clinic's
 * billing health and flips `clinics.status` active↔past_due as time passes (the
 * time-based downgrade a payment event can't trigger; Feature 6 ↔ Feature 2).
 * Same auth as the other crons: `Authorization: Bearer <CRON_SECRET>` or
 * `?token=<CRON_SECRET>`. sweepClinicBillingStatus opts out of the tenant guard
 * (it spans all clinics).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const provided = bearer || url.searchParams.get("token") || "";

  if (serverEnv.CRON_SECRET) {
    if (provided !== serverEnv.CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  } else if (isProduction) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }

  const result = await sweepClinicBillingStatus();
  return NextResponse.json({ ok: true, ...result });
}
