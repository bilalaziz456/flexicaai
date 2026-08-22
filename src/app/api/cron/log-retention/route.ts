import { NextResponse } from "next/server";
import { pruneActivityLogs } from "@/core/audit/retention";
import { runCron } from "@/core/security/cron";

/**
 * GET /api/cron/log-retention — prunes `activity_logs` past the configured window
 * (delta D-11). Under ADR-006 nothing is removed anywhere, so this append-only table
 * grows without bound; `view` rows dominate it.
 *
 * **Does nothing until an owner sets a retention window.** The default is "keep
 * everything", because this is the audit trail over patient data (CLAUDE.md §10) and
 * how long it must survive is a regulatory decision, not an engineering one. Both
 * outcomes are reported, so "ran and correctly pruned nothing" stays distinguishable
 * from "never ran" — the failure mode every job here shares.
 *
 * Triggered by system cron (CLAUDE.md §2a); `runCron` supplies auth, a correlation id
 * and crash reporting.
 */
export async function GET(request: Request) {
  return runCron(request, "cron.logRetention", async () => {
    const result = await pruneActivityLogs();
    return NextResponse.json({ ok: true, ...result });
  });
}
