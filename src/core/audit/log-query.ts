import "server-only";

import { and, count, desc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/core/db";
import { activityLogs, clinics } from "@/core/db/schema";
import { unscoped } from "@/core/db/tenant-guard";

/**
 * The super admin's activity-log page query — CORE per ADR-014, where it can be read
 * and reused instead of living in the page that renders it.
 *
 * Cross-tenant by design: this is the platform's internal audit trail, so it is
 * `unscoped` with the reason stated rather than tripping the guard (ADR-005/018).
 */
export type AdminLogFilters = {
  start: Date;
  endExclusive: Date;
  clinicId?: string;
  actorId?: string;
  action?: string;
};

export type AdminLogRow = {
  id: string;
  createdAt: Date;
  actorName: string;
  actorRole: string | null;
  action: string;
  summary: string;
  clinicName: string | null;
};

export async function listAdminActivityLogs(
  filters: AdminLogFilters,
  paging: { offset: number; limit: number },
): Promise<{ rows: AdminLogRow[]; total: number }> {
  const conds = [
    gte(activityLogs.createdAt, filters.start),
    lt(activityLogs.createdAt, filters.endExclusive),
  ];
  if (filters.clinicId) conds.push(eq(activityLogs.clinicId, filters.clinicId));
  // The employee filter only applies within a chosen clinic (its option list is
  // clinic-scoped), so a stray actor with no clinic selected is ignored.
  if (filters.clinicId && filters.actorId) conds.push(eq(activityLogs.actorUserId, filters.actorId));
  if (filters.action) conds.push(eq(activityLogs.action, filters.action));
  const where = and(...conds);

  return unscoped("admin: activity logs across all clinics", async () => {
    const [rows, [totalRow]] = await Promise.all([
      db
        .select({
          id: activityLogs.id,
          createdAt: activityLogs.createdAt,
          actorName: activityLogs.actorName,
          actorRole: activityLogs.actorRole,
          action: activityLogs.action,
          summary: activityLogs.summary,
          clinicName: clinics.name,
        })
        .from(activityLogs)
        .leftJoin(clinics, eq(activityLogs.clinicId, clinics.id))
        .where(where)
        .orderBy(desc(activityLogs.createdAt))
        .limit(paging.limit)
        .offset(paging.offset),
      db.select({ total: count() }).from(activityLogs).where(where),
    ]);
    return { rows, total: totalRow?.total ?? 0 };
  });
}
