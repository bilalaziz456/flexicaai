import { listClinicActivityLogs } from "@/core/audit/log-query";
import { listClinicActorOptions } from "@/core/clinics/options";
import { requireClinicAdmin } from "@/core/auth/user";
import { getClinic } from "@/core/clinics/get-clinic";
import { ActivityLogList } from "@/core/ui/activity-log";
import { LogFilters } from "@/core/ui/log-filters";
import { Pagination } from "@/core/ui/pagination";
import { parseLogFilters } from "@/core/audit/log-filters";
import { CLINIC_LOG_STAFF_ROLES, logActionLabel } from "@/core/audit/access";
import { pageOffset, parsePage, parsePageSize } from "@/core/lib/pagination";

/**
 * Clinic Admin: their clinic's activity log — but only if the super admin has
 * granted this clinic log access (`clinics.log_access`), and only the ACTION
 * categories granted. Defaults to today; filterable by date range + employee.
 * Clinic-scoped.
 */
export default async function ClinicLogsPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    actor?: string;
    action?: string;
    page?: string;
    size?: string;
  }>;
}) {
  const { clinicId } = await requireClinicAdmin();
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.size);
  const { fromStr, toStr, today, actor, action, start, endExclusive } =
    parseLogFilters(sp);

  const clinic = await getClinic(clinicId);
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

  // The action filter can only narrow WITHIN the granted categories; an
  // out-of-scope value is ignored (never widens access).
  const activeAction = allowedActions.includes(action) ? action : "";

  const [{ rows, total }, actors] = await Promise.all([
    // Scope, granted categories and the clinic-own-staff rule all live in core.
    listClinicActivityLogs(
      clinicId,
      { start, endExclusive, allowedActions, action: activeAction || undefined, actorId: actor || undefined },
      { offset: pageOffset(page, pageSize), limit: pageSize },
    ),
    // Employee options = the clinic's OWN staff (from the users table), so the
    // dropdown lists everyone even before they have generated any logs.
    listClinicActorOptions(clinicId, { roles: CLINIC_LOG_STAFF_ROLES }),
  ]);

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
        action={activeAction}
        actionOptions={allowedActions.map((id) => ({
          value: id,
          label: logActionLabel(id),
        }))}
      />
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath="/clinic/logs"
        searchParams={sp}
        unit="entry"
      />
      <ActivityLogList
        rows={rows}
        emptyHint="No activity matches these filters."
      />
    </div>
  );
}
