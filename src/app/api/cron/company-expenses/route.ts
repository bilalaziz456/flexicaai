import { NextResponse } from "next/server";
import { generateDueRecurringCompanyExpenses } from "@/core/admin/company-expenses-recurring";
import { requireCron } from "@/core/security/cron";

/**
 * GET /api/cron/company-expenses — materialises every recurring COMPANY expense that
 * has come due, cloning each template into a plain expense per missed period and
 * advancing its `next_run_on`. Triggered by Vercel Cron; auth is the shared
 * `requireCron` guard (Bearer <CRON_SECRET> or ?token=…). (company_expenses has no
 * clinic_id → no tenant-guard opt-out needed.)
 */
export async function GET(request: Request) {
  const denied = requireCron(request);
  if (denied) return denied;

  const result = await generateDueRecurringCompanyExpenses();
  return NextResponse.json({ ok: true, ...result });
}
