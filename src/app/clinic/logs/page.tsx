import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { requireClinicAdmin } from "@/core/auth/user";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { activityLogs, clinics, users } from "@/core/db/schema";
import { ActivityLogList } from "@/core/ui/activity-log";
import { LogFilters } from "@/core/ui/log-filters";
import { parseLogFilters } from "@/core/audit/log-filters";
import { CLINIC_LOG_ROLES, logActionLabel } from "@/core/audit/access";
import type { UserRole } from "@/core/types/auth";

/**
 * Clinic Admin: their clinic's activity log — but only if the super admin has
 * granted this clinic log access (`clinics.log_access`), and only the ACTION
 * categories granted. Defaults to today; filterable by date range + employee.
 * Clinic-scoped.
 */
export default async function ClinicLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; actor?: string }>;
}) {
  const { clinicId } = await requireClinicAdmin();
  const sp = await searchParams;
  const { fromStr, toStr, today, actor, start, endExclusive } = parseLogFilters(sp);

  const [clinic] = await db
    .select({ logAccess: clinics.logAccess })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  const allowedActions = clinic?.logAccess ?? [];

  // No categories granted → the clinic has no log access at all.
  if (allowedActions.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Activity log</h1>
        </div>
        <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          Your clinic doesn&apos;t have activity-log access. Ask the platform
          administrator to enable it.
        </div>
      </div>
    );
  }

  // Base scope: this clinic, only the granted action categories, and only the
  // clinic's OWN staff — never super-admin actions (those are super-admin-only).
  const conds = [
    inArray(activityLogs.action, allowedActions),
    inArray(activityLogs.actorRole, [...CLINIC_LOG_ROLES]),
  ];
  conds.push(gte(activityLogs.createdAt, start));
  conds.push(lt(activityLogs.createdAt, endExclusive));
  if (actor) conds.push(eq(activityLogs.actorUserId, actor));

  const [rows, staff] = await Promise.all([
    db
      .select({
        id: activityLogs.id,
        createdAt: activityLogs.createdAt,
        actorName: activityLogs.actorName,
        actorRole: activityLogs.actorRole,
        action: activityLogs.action,
        summary: activityLogs.summary,
      })
      .from(activityLogs)
      .where(byClinic(activityLogs.clinicId, clinicId, and(...conds)))
      .orderBy(desc(activityLogs.createdAt))
      .limit(300),
    // Employee options = the clinic's OWN staff (from the users table), so the
    // dropdown lists everyone even before they've generated any logs.
    db
      .select({ id: users.id, fullName: users.fullName, username: users.username })
      .from(users)
      .where(
        byClinic(
          users.clinicId,
          clinicId,
          inArray(users.role, [...CLINIC_LOG_ROLES] as UserRole[]),
        ),
      )
      .orderBy(asc(users.fullName)),
  ]);
  const actors = staff.map((s) => ({ id: s.id, name: s.fullName ?? s.username }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Activity log</h1>
        <p className="text-sm text-muted-foreground">
          Showing: {allowedActions.map(logActionLabel).join(", ")}.
        </p>
      </div>
      <LogFilters
        from={fromStr}
        to={toStr}
        today={today}
        actor={actor}
        actors={actors}
      />
      <ActivityLogList
        rows={rows}
        emptyHint="No activity matches these filters."
      />
    </div>
  );
}
