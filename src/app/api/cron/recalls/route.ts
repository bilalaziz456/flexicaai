import { NextResponse } from "next/server";
import { processDueRecalls } from "@/core/recall";
import { unscoped } from "@/core/db/tenant-guard";
import { runCron } from "@/core/security/cron";

/**
 * GET /api/cron/recalls — runs the recall engine: sends reminders for recalls
 * that are due. Triggered by system cron / a systemd timer (CLAUDE.md §2a).
 * Wrapped by `runCron`: auth (Bearer <CRON_SECRET> or ?token=…) + a correlation id +
 * crash reporting, since a cron has no user watching it.
 */
export async function GET(request: Request) {
  return runCron(request, "cron.recalls", async () => {
    // System job: runs across every clinic → opt out of the tenant guard.
    const result = await unscoped("cron: recalls (all clinics)", () => processDueRecalls());
    return NextResponse.json({ ok: true, ...result });
  });
}
