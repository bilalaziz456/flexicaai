import { NextResponse } from "next/server";
import { sendDueAppointmentReminders } from "@/core/notifications/appointment";
import { unscoped } from "@/core/db/tenant-guard";
import { runCron } from "@/core/security/cron";

/**
 * GET /api/cron/reminders — sends the day-before WhatsApp reminder for every
 * appointment happening tomorrow. Triggered by Vercel Cron; wrapped by `runCron`, which
 * authorizes (Bearer <CRON_SECRET> or ?token=…), gives the run a correlation id, and
 * reports a crash — a cron has no user watching it.
 */
export async function GET(request: Request) {
  return runCron(request, "cron.reminders", async () => {
    // System job: runs across every clinic → opt out of the tenant guard.
    const result = await unscoped("cron: reminders (all clinics)", () => sendDueAppointmentReminders());
    return NextResponse.json({ ok: true, ...result });
  });
}
