import { and, asc, count, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { requireRole } from "@/core/auth/user";
import { db } from "@/core/db";
import { activityLogs, clinics, users } from "@/core/db/schema";
import { ActivityLogList } from "@/core/ui/activity-log";
import { LogFilters } from "@/core/ui/log-filters";
import { Pagination } from "@/core/ui/pagination";
import { parseLogFilters } from "@/core/audit/log-filters";
import { unscoped } from "@/core/db/tenant-guard";
import {
  CLINIC_LOG_ROLES,
  LOG_ACTIONS,
  LOG_ACTION_IDS,
} from "@/core/audit/access";
import { pageOffset, parsePage, parsePageSize } from "@/core/lib/pagination";
import type { UserRole } from "@/core/types/auth";

/**
 * Super Admin: the full platform activity log — every clinic, every action.
 * Defaults to today; filterable by date range, clinic, and employee. Not
 * clinic-scoped: this is the internal audit trail.
 */
export default async function AdminLogsPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    actor?: string;
    clinic?: string;
    action?: string;
    page?: string;
    size?: string;
  }>;
}) {
  await requireRole("super_admin");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.size);
  const { fromStr, toStr, today, actor, clinic, action, start, endExclusive } =
    parseLogFilters(sp);
  // The super admin can filter by any known action category.
  const activeAction = LOG_ACTION_IDS.includes(action) ? action : "";

  const conds = [
    gte(activityLogs.createdAt, start),
    lt(activityLogs.createdAt, endExclusive),
  ];
  if (clinic) conds.push(eq(activityLogs.clinicId, clinic));
  // The employee filter only applies within a chosen clinic (its list is
  // clinic-scoped), so ignore a stray actor when no clinic is selected.
  if (clinic && actor) conds.push(eq(activityLogs.actorUserId, actor));
  if (activeAction) conds.push(eq(activityLogs.action, activeAction));

  const where = and(...conds);
  // Super-admin view spans every clinic by design — opt out of the tenant guard.
  const [rows, clinicRows, actorRows, [{ total }]] = await unscoped(
    "admin: activity logs across all clinics",
    () => Promise.all([
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
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    db
      .select({ id: clinics.id, name: clinics.name })
      .from(clinics)
      .orderBy(asc(clinics.name)),
    // Employee options exist ONLY once a clinic is picked — that clinic's staff
    // (from the users table, so everyone appears even without logs yet).
    clinic
      ? db
          .select({ id: users.id, fullName: users.fullName, username: users.username })
          .from(users)
          .where(
            and(
              eq(users.clinicId, clinic),
              inArray(users.role, [...CLINIC_LOG_ROLES] as UserRole[]),
            ),
          )
          .orderBy(asc(users.fullName))
      : Promise.resolve([] as { id: string; fullName: string | null; username: string }[]),
    db.select({ total: count() }).from(activityLogs).where(where),
    ]),
  );
  const actors = actorRows.map((s) => ({ id: s.id, name: s.fullName ?? s.username }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Activity log</h1>
        <p className="text-sm text-muted-foreground">
          {total} action{total === 1 ? "" : "s"} across all clinics for the
          selected range.
        </p>
      </div>
      <LogFilters
        from={fromStr}
        to={toStr}
        today={today}
        actor={actor}
        actors={actors}
        clinic={clinic}
        clinics={clinicRows}
        action={activeAction}
        actionOptions={LOG_ACTIONS.map((a) => ({ value: a.id, label: a.label }))}
      />
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath="/admin/logs"
        searchParams={sp}
        unit="entry"
      />
      <ActivityLogList
        rows={rows}
        showClinic
        emptyHint="No activity matches these filters."
      />
    </div>
  );
}
