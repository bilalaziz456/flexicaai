import { NextResponse } from "next/server";
import { generateDueRecurringCompanyExpenses } from "@/core/admin/company-expenses-recurring";
import { serverEnv, isProduction } from "@/core/lib/env";

/**
 * GET /api/cron/company-expenses — materialises every recurring COMPANY expense that
 * has come due, cloning each template into a plain expense per missed period and
 * advancing its `next_run_on`. Triggered by Vercel Cron (`Authorization: Bearer
 * <CRON_SECRET>`); also accepts ?token=<CRON_SECRET> for manual runs. Same auth shape
 * as /api/cron/expenses. (company_expenses has no clinic_id → no tenant-guard opt-out
 * needed.)
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

  const result = await generateDueRecurringCompanyExpenses();
  return NextResponse.json({ ok: true, ...result });
}
