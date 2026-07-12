import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import { requireClinicAdmin } from "@/core/auth/user";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { activityLogs } from "@/core/db/schema";
import { ActivityLogList } from "@/core/ui/activity-log";
import { LogFilters } from "@/core/ui/log-filters";
import { LOG_VISIBLE_DAYS } from "@/core/audit/log";
import { parseLogFilters } from "@/core/audit/log-filters";

/**
 * Clinic Admin: their clinic's activity log. Shows only STILL-VISIBLE rows
 * (a daily cron hides anything older than 5 days); the full history stays with
 * the super admin. Filterable by date range + actor. Clinic-scoped.
 */
export default async function ClinicLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; actor?: string }>;
}) {
  const { clinicId } = await requireClinicAdmin();
  const sp = await searchParams;
  const { fromStr, toStr, actor, start, endExclusive } = parseLogFilters(sp);

  // Base scope: this clinic, still-visible rows.
  const conds = [eq(activityLogs.visible, true)];
  if (start) conds.push(gte(activityLogs.createdAt, start));
  if (endExclusive) conds.push(lt(activityLogs.createdAt, endExclusive));
  if (actor) conds.push(eq(activityLogs.actorName, actor));

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
      })
      .from(activityLogs)
      .where(byClinic(activityLogs.clinicId, clinicId, and(...conds)))
      .orderBy(desc(activityLogs.createdAt))
      .limit(200),
    // Actor dropdown options: distinct actors in this clinic's visible logs.
    db
      .selectDistinct({ name: activityLogs.actorName })
      .from(activityLogs)
      .where(byClinic(activityLogs.clinicId, clinicId, eq(activityLogs.visible, true)))
      .orderBy(asc(activityLogs.actorName)),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Activity log</h1>
        <p className="text-sm text-muted-foreground">
          What your team has done. Entries older than {LOG_VISIBLE_DAYS} days drop
          off this view.
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
        emptyHint="No activity matches these filters."
      />
    </div>
  );
}
