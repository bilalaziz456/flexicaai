import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import { requireRole } from "@/core/auth/user";
import { db } from "@/core/db";
import { activityLogs, clinics } from "@/core/db/schema";
import { ActivityLogList } from "@/core/ui/activity-log";
import { LogFilters } from "@/core/ui/log-filters";
import { parseLogFilters } from "@/core/audit/log-filters";

/**
 * Super Admin: the full platform activity log — EVERY clinic, and every row
 * including the ones hidden from clinic admins (older than 5 days). Filterable
 * by date range + actor. Not clinic-scoped: this is the internal audit trail.
 */
export default async function AdminLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; actor?: string }>;
}) {
  await requireRole("super_admin");
  const sp = await searchParams;
  const { fromStr, toStr, actor, start, endExclusive } = parseLogFilters(sp);

  const conds = [];
  if (start) conds.push(gte(activityLogs.createdAt, start));
  if (endExclusive) conds.push(lt(activityLogs.createdAt, endExclusive));
  if (actor) conds.push(eq(activityLogs.actorName, actor));
  const where = conds.length ? and(...conds) : undefined;

  const [rows, actorRows] = await Promise.all([
    db
      .select({
        id: activityLogs.id,
        createdAt: activityLogs.createdAt,
        actorName: activityLogs.actorName,
        actorRole: activityLogs.actorRole,
        action: activityLogs.action,
        summary: activityLogs.summary,
        visible: activityLogs.visible,
        clinicName: clinics.name,
      })
      .from(activityLogs)
      .leftJoin(clinics, eq(activityLogs.clinicId, clinics.id))
      .where(where)
      .orderBy(desc(activityLogs.createdAt))
      .limit(300),
    db
      .selectDistinct({ name: activityLogs.actorName })
      .from(activityLogs)
      .orderBy(asc(activityLogs.actorName)),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Activity log</h1>
        <p className="text-sm text-muted-foreground">
          {rows.length} most-recent action{rows.length === 1 ? "" : "s"} across all
          clinics — including entries hidden from clinic admins.
        </p>
      </div>
      <LogFilters
        from={fromStr}
        to={toStr}
        actor={actor}
        actors={actorRows.map((a) => a.name)}
      />
      <ActivityLogList
        rows={rows}
        showClinic
        showVisibility
        emptyHint="No activity matches these filters."
      />
    </div>
  );
}
