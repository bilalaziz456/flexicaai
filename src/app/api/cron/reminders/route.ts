import { NextResponse } from "next/server";
import { sendDueAppointmentReminders } from "@/core/notifications/appointment";
import { unscoped } from "@/core/db/tenant-guard";
import { serverEnv, isProduction } from "@/core/lib/env";

/**
 * GET /api/cron/reminders — sends the day-before WhatsApp reminder for every
 * appointment happening tomorrow. Triggered by Vercel Cron (which sends
 * `Authorization: Bearer <CRON_SECRET>`); also accepts ?token=<CRON_SECRET> for
 * manual runs. Same auth shape as /api/cron/recalls.
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

  // System job: runs across every clinic → opt out of the tenant guard.
  const result = await unscoped("cron: reminders (all clinics)", () => sendDueAppointmentReminders());
  return NextResponse.json({ ok: true, ...result });
}
