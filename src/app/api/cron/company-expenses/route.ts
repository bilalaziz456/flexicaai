import { NextResponse } from "next/server";
import { generateDueRecurringCompanyExpenses } from "@/core/admin/company-expenses-recurring";
import { runCron } from "@/core/security/cron";

/**
 * GET /api/cron/company-expenses — materialises every recurring COMPANY expense that
 * has come due, cloning each template into a plain expense per missed period and
 * advancing its `next_run_on`. Triggered by system cron / a systemd timer (CLAUDE.md §2a); wrapped by `runCron`, which
 * authorizes (Bearer <CRON_SECRET> or ?token=…), gives the run a correlation id, and
 * reports a crash — a cron has no user watching it. (company_expenses has no
 * clinic_id → no tenant-guard opt-out needed.)
 */
export async function GET(request: Request) {
  return runCron(request, "cron.companyExpenses", async () => {
    const result = await generateDueRecurringCompanyExpenses();
    return NextResponse.json({ ok: true, ...result });
  });
}
