import { NextResponse } from "next/server";
import { hideOldLogs } from "@/core/audit/log";
import { serverEnv, isProduction } from "@/core/lib/env";

/**
 * GET /api/cron/log-visibility — hides activity logs older than 5 days from the
 * clinic admin (flips `visible` to false; super admin still sees them).
 * Triggered by Vercel Cron (`Authorization: Bearer <CRON_SECRET>`); also accepts
 * ?token=<CRON_SECRET> for manual runs. Same auth shape as the other crons.
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
    return NextResponse.json(
      { error: "CRON_SECRET is not configured." },
      { status: 503 },
    );
  }

  const result = await hideOldLogs();
  return NextResponse.json({ ok: true, ...result });
}
