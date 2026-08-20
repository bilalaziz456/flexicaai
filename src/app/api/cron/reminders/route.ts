import { NextResponse } from "next/server";
import { sendDueAppointmentReminders } from "@/core/notifications/appointment";
import { unscoped } from "@/core/db/tenant-guard";
import { requireCron } from "@/core/security/cron";

/**
 * GET /api/cron/reminders — sends the day-before WhatsApp reminder for every
 * appointment happening tomorrow. Triggered by Vercel Cron; auth is the shared
 * `requireCron` guard (Bearer <CRON_SECRET> or ?token=…).
 */
export async function GET(request: Request) {
  const denied = requireCron(request);
  if (denied) return denied;

  // System job: runs across every clinic → opt out of the tenant guard.
  const result = await unscoped("cron: reminders (all clinics)", () => sendDueAppointmentReminders());
  return NextResponse.json({ ok: true, ...result });
}
