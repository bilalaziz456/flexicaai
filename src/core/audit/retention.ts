import "server-only";

import { lt, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { activityLogs } from "@/core/db/schema";
import { getActivityLogRetentionDays } from "@/core/admin/company-settings";
import { unscoped } from "@/core/db/tenant-guard";
import { reportEvent } from "@/core/observability";

/**
 * `activity_logs` retention — CORE, company-level (delta D-11).
 *
 * THE PROBLEM: every clinic-staff action, every login and every record view appends a
 * row, and under ADR-006 nothing is ever removed. The table only grows, and `view`
 * rows dominate. On a single-node box that is a disk and vacuum problem long before
 * it is a query problem.
 *
 * THE CARE REQUIRED: this is the audit trail over patient data (CLAUDE.md §10). It is
 * evidence — of who opened which record, and of who changed what. Deleting it is not
 * a housekeeping decision, so:
 *
 *   - **The default is 0, meaning keep everything.** Nothing is deleted until the
 *     owner sets a window, because how long a Pakistani or GCC clinic's access log
 *     must survive is a regulatory question, not an engineering one.
 *   - The floor is 90 days. A window shorter than that is much more likely to be a
 *     typo than an intention, and the damage is unrecoverable.
 *   - This is the ONLY hard delete in the audit path, and it is deliberate: a
 *     soft-deleted audit row would defeat the whole point — the table would still
 *     grow, which is the problem being solved.
 *
 * Runs from `GET /api/cron/log-retention`.
 */

/** Never prune more recently than this, whatever the setting says. */
export const MIN_RETENTION_DAYS = 90;

export type PruneResult = {
  /** The configured window, 0 when retention is off. */
  retentionDays: number;
  /** Rows removed. Always 0 when retention is off. */
  deleted: number;
};

/**
 * Deletes activity rows older than the configured window. A no-op — reported as such,
 * not silently — when retention is unset.
 *
 * Cross-tenant by nature: this is the company pruning its own platform table, and
 * `activity_logs` carries a `clinic_id`, so the tenant guard would flag it. Wrapped in
 * `unscoped` to say that out loud rather than to dodge the check.
 */
export async function pruneActivityLogs(now = new Date()): Promise<PruneResult> {
  const retentionDays = await getActivityLogRetentionDays();
  if (retentionDays <= 0) {
    // Worth an event: "the job ran and deliberately did nothing" and "the job never
    // ran at all" look identical from the outside, and only one of them is fine.
    reportEvent("activity-log retention is off — nothing pruned", {
      op: "audit.retention",
      severity: "info",
    });
    return { retentionDays: 0, deleted: 0 };
  }

  const days = Math.max(MIN_RETENTION_DAYS, retentionDays);
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const deleted = await unscoped("company prunes its own activity_logs", async () => {
    const rows = await db
      .delete(activityLogs)
      .where(lt(activityLogs.createdAt, cutoff))
      .returning({ id: activityLogs.id });
    return rows.length;
  });

  reportEvent("activity-log retention pruned", {
    op: "audit.retention",
    severity: "info",
    extra: { retentionDays: days, deleted, cutoff: cutoff.toISOString() },
  });

  return { retentionDays: days, deleted };
}

/**
 * How big the table is and how far back it goes — shown beside the retention control
 * so the number is set against real data rather than guessed. Two cheap aggregates on
 * indexed columns; not called on a hot path.
 */
export async function getActivityLogStats(): Promise<{
  rows: number;
  oldest: Date | null;
  sizePretty: string;
}> {
  const [row] = await unscoped("company reads its own activity_logs size", () =>
    db
      .select({
        rows: sql<number>`count(*)::int`,
        // `.mapWith` is what makes the declared type TRUE. `sql<Date>` is only an
        // assertion: a bare aggregate carries no column metadata, so the driver hands
        // back the raw timestamptz STRING and the value reaching the UI has no
        // `toLocaleDateString` — a runtime crash on a page that type-checked cleanly.
        // Passing the column applies its own driver mapper.
        oldest: sql<Date | null>`min(${activityLogs.createdAt})`.mapWith(
          activityLogs.createdAt,
        ),
        sizePretty: sql<string>`pg_size_pretty(pg_total_relation_size('activity_logs'))`,
      })
      .from(activityLogs),
  );
  return {
    rows: row?.rows ?? 0,
    oldest: row?.oldest ?? null,
    sizePretty: row?.sizePretty ?? "0 bytes",
  };
}
