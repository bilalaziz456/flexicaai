import { NextResponse } from "next/server";
import { processDueRecalls } from "@/core/recall";
import { unscoped } from "@/core/db/tenant-guard";
import { requireCron } from "@/core/security/cron";

/**
 * GET /api/cron/recalls — runs the recall engine: sends reminders for recalls
 * that are due. Triggered by Vercel Cron (CLAUDE.md §2 — start with Vercel Cron).
 * Auth is the shared `requireCron` guard (Bearer <CRON_SECRET> or ?token=…).
 */
export async function GET(request: Request) {
  const denied = requireCron(request);
  if (denied) return denied;

  // System job: runs across every clinic → opt out of the tenant guard.
  const result = await unscoped("cron: recalls (all clinics)", () => processDueRecalls());
  return NextResponse.json({ ok: true, ...result });
}
