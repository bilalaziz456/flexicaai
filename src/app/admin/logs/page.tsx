import { requireRole } from "@/core/auth/user";
import { ActivityLogList } from "@/core/ui/activity-log";
import { LogFilters } from "@/core/ui/log-filters";
import { Pagination } from "@/core/ui/pagination";
import { parseLogFilters } from "@/core/audit/log-filters";
import {
  CLINIC_LOG_ROLES,
  LOG_ACTIONS,
  LOG_ACTION_IDS,
} from "@/core/audit/access";
import { pageOffset, parsePage, parsePageSize } from "@/core/lib/pagination";
import { listClinicActorOptions, listClinicOptions } from "@/core/clinics/options";
import { getActivityLogRetentionDays } from "@/core/admin/company-settings";
import { getActivityLogStats } from "@/core/audit/retention";
import { listAdminActivityLogs } from "@/core/audit/log-query";
import { RetentionForm } from "./retention-form";

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

  const [{ rows, total }, clinicRows, actors] = await Promise.all([
    listAdminActivityLogs(
      { start, endExclusive, clinicId: clinic, actorId: actor, action: activeAction },
      { offset: pageOffset(page, pageSize), limit: pageSize },
    ),
    // includeDeleted: a TRASHED clinic still has logs, so it must stay filterable.
    listClinicOptions({ includeDeleted: true }),
    // Employee options exist ONLY once a clinic is picked — that clinic's staff
    // (from the users table, so everyone appears even without logs yet).
    clinic ? listClinicActorOptions(clinic, { roles: CLINIC_LOG_ROLES }) : Promise.resolve([]),
  ]);
  // Retention state, shown with the table's real size so the window is chosen
  // against what is actually stored rather than guessed (D-11).
  const [retentionDays, logStats] = await Promise.all([
    getActivityLogRetentionDays(),
    getActivityLogStats(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Activity log</h1>
        <p className="text-sm text-muted-foreground">
          {total} action{total === 1 ? "" : "s"} across all clinics for the
          selected range.
        </p>
      </div>
      <RetentionForm
        retentionDays={retentionDays}
        rows={logStats.rows}
        oldest={logStats.oldest}
        sizePretty={logStats.sizePretty}
      />
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
