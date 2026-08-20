import { NextResponse } from "next/server";
import { generateDueRecurringExpenses } from "@/core/expenses/recurring";
import { unscoped } from "@/core/db/tenant-guard";
import { requireCron } from "@/core/security/cron";

/**
 * GET /api/cron/expenses — materialises every recurring expense that has come due
 * (across all clinics), cloning each template into a plain expense per missed period
 * and advancing its `next_run_on`. Triggered by Vercel Cron; auth is the shared
 * `requireCron` guard (Bearer <CRON_SECRET> or ?token=…).
 */
export async function GET(request: Request) {
  const denied = requireCron(request);
  if (denied) return denied;

  // System job: runs across every clinic → opt out of the tenant guard.
  const result = await unscoped("cron: recurring expenses (all clinics)", () => generateDueRecurringExpenses());
  return NextResponse.json({ ok: true, ...result });
}
