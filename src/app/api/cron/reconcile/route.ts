import { NextResponse } from "next/server";
import { reconcileAllClinics } from "@/core/sales/reconcile";
import { runCron } from "@/core/security/cron";

/**
 * GET /api/cron/reconcile — nightly sales reconciliation (ADR-016). Re-derives any
 * sale that has drifted from its appointment, and voids revenue left on the books for
 * a visit that is no longer completed.
 *
 * This is the repair half of the derived-ledger design: the write paths that stay
 * best-effort (taking a payment, above all) can fail without blocking the user
 * precisely because this puts them right afterwards. Skip installing it and those
 * paths become silent data loss again — the reports would still fire, but nothing
 * would fix anything.
 *
 * Triggered by system cron / a systemd timer (CLAUDE.md §2a); wrapped by `runCron`
 * for auth, a correlation id, and crash reporting.
 */
export async function GET(request: Request) {
  return runCron(request, "cron.reconcile", async () => {
    const result = await reconcileAllClinics();
    return NextResponse.json({ ok: true, ...result });
  });
}
