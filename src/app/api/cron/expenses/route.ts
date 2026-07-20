import { NextResponse } from "next/server";
import { generateDueRecurringExpenses } from "@/core/expenses/recurring";
import { unscoped } from "@/core/db/tenant-guard";
import { serverEnv, isProduction } from "@/core/lib/env";

/**
 * GET /api/cron/expenses — materialises every recurring expense that has come due
 * (across all clinics), cloning each template into a plain expense per missed period
 * and advancing its `next_run_on`. Triggered by Vercel Cron (which sends
 * `Authorization: Bearer <CRON_SECRET>`); also accepts ?token=<CRON_SECRET> for
 * manual runs. Same auth shape as /api/cron/reminders.
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
  const result = await unscoped("cron: recurring expenses (all clinics)", () => generateDueRecurringExpenses());
  return NextResponse.json({ ok: true, ...result });
}
