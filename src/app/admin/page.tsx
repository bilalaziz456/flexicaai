import { clinicListWhere, listClinicsPage } from "@/core/clinics/options";
import Link from "next/link";
import { Plus } from "lucide-react";
import { SPECIALTY_CATALOG } from "@/config/modules";
import { CLINIC_STATUSES, isClinicStatus } from "@/core/clinics/status";
import { requireRole } from "@/core/auth/user";
import { canAdmin, canManageTeam, canSeeBilling } from "@/core/auth/admin-permissions";
import { getFirstPaymentDates, listDueClinics } from "@/core/admin/billing";
import { listAssignableTeam } from "@/core/admin/assignment";
import { getCompanyMetrics } from "@/core/admin/metrics";
import { CompanyMetricsPanel } from "./company-metrics";
import { ClinicsFilters } from "./clinics-filters";
import { ClinicsTable } from "./clinics-table";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";
import { pageOffset, parsePage, parsePageSize } from "@/core/lib/pagination";
import { Pagination } from "@/core/ui/pagination";
import { FlashToast } from "@/core/ui/toast";
import { vocabularyLabel } from "@/core/db/vocabulary-cache";
import {
  countClinicsWithoutCity,
  getClinicCountsByCity,
  getClinicCountsByProvince,
} from "@/core/clinics/cities";
import { asProvinceCode, PROVINCES, provinceLabel } from "@/core/clinics/provinces";

const SPECIALTY_NAME = new Map(SPECIALTY_CATALOG.map((s) => [s.id, s.name]));

/** Super Admin home — all clinics on the platform, with name search. */
export default async function AdminHome({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    page?: string;
    size?: string;
    deleted?: string;
    assigned?: string;
    billing?: string;
    province?: string;
    city?: string;
  }>;
}) {
  const user = await requireRole("super_admin");
  const sp = await searchParams;
  const query = sp.q?.trim();
  const statusFilter = sp.status && isClinicStatus(sp.status) ? sp.status : undefined;
  // Narrowed, never cast: an unrecognised province drops its condition rather than
  // matching nothing and reading as "no clinics there".
  const provinceFilter = asProvinceCode(sp.province) ?? undefined;
  const cityFilter = Number.isInteger(Number(sp.city)) && Number(sp.city) > 0 ? Number(sp.city) : undefined;

  // VISIBILITY SCOPE: owner + super_admin see every clinic; other team members
  // (sales / support / billing) see ONLY clinics assigned to them.
  const seesAll = canManageTeam(user);
  // A scoped team member is pinned to their own clinics; full access sees all.
  const scopeAssignee = seesAll ? undefined : user.id;

  // Assigned-to filter: "me" · "unassigned" · a team-member id. (Full-access only —
  // scoped users already see only their own.)
  const assignedFilter = seesAll ? sp.assigned?.trim() || undefined : undefined;
  // `null` = UNASSIGNED specifically; `undefined` = do not filter by manager.
  const assignedTo =
    assignedFilter === "unassigned"
      ? null
      : assignedFilter === "me"
        ? user.id
        : (assignedFilter ?? scopeAssignee);

  // Billing filter: due | overdue — filters the list by computed billing health.
  const billingFilter = sp.billing === "due" || sp.billing === "overdue" ? sp.billing : undefined;
  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.size);
  const toastMessage = sp.deleted ? "Clinic deleted." : null;

  // The full financial panel is `metrics:view`; the due/overdue list is billing
  // VISIBILITY (owner + sales + billing + support see it). Feature 9.
  const showMetrics = canAdmin(user, "metrics:view");
  // MRR + ARR are gated tighter than the rest of the panel (owner + super_admin by
  // default; grantable via `revenue:view`).
  const showRevenue = canAdmin(user, "revenue:view");
  const showBilling = canSeeBilling(user);

  // Due/overdue is fetched first — it feeds the panel AND the billing filter, and is
  // scoped to what this user may see.
  const dueAll = showBilling ? await listDueClinics({ includeUpcoming: true }) : [];
  const visibleAlerts = dueAll.filter((c) => seesAll || c.assignedTo === user.id);
  const dueClinics = visibleAlerts.filter((c) => c.alert !== "upcoming");
  const upcomingClinics = visibleAlerts.filter((c) => c.alert === "upcoming");

  // Billing filter → the set of clinic ids matching that billing status.
  const billingIds = billingFilter
    ? dueClinics.filter((c) => c.balance.billingStatus === billingFilter).map((c) => c.id)
    : undefined;
  const where = clinicListWhere({
    q: query,
    status: statusFilter,
    assignedTo,
    billingIds,
    province: provinceFilter,
    cityId: cityFilter,
  });
  const [{ rows: clinicRows, total }, metrics, team] = await Promise.all([
    listClinicsPage(where, { offset: pageOffset(page, pageSize), limit: pageSize }),
    // Scope the financial panel like the list: full access → company-wide; a
    // scoped team member → only the clinics assigned to them. Serving cost + margin
    // are folded in only for viewers who may see the money figures (revenue:view).
    showMetrics
      ? getCompanyMetrics(seesAll ? { withCost: showRevenue } : { assignedTo: user.id, withCost: showRevenue })
      : Promise.resolve(null),
    seesAll ? listAssignableTeam() : Promise.resolve([]),
  ]);
  // WHERE the clinics are. Reported next to the list rather than on the Overview: this
  // is the page you are already on when you ask "how many do we have in Lahore", and
  // each row links straight to that filtered list.
  const [cityCounts, provinceCounts, noCity] = await Promise.all([
    getClinicCountsByCity(500),
    getClinicCountsByProvince(),
    countClinicsWithoutCity(),
  ]);
  const allClinics = clinicRows.map((r) => ({
    ...r.clinic,
    assigneeName: r.assigneeName ?? r.assigneeUsername,
    assigneeSuspended: r.assigneeActive === false,
  }));

  // First real payment per clinic (billing viewers only) — one grouped query over the
  // page's clinics, so the list stays a single round-trip regardless of clinic count.
  const firstPayments = showBilling
    ? await getFirstPaymentDates(allClinics.map((c) => c.id))
    : new Map<string, Date>();

  return (
    <div className="space-y-6">
      <FlashToast message={toastMessage} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Clinics</h1>
          <p className="text-sm text-muted-foreground">
            {total} clinic{total === 1 ? "" : "s"}
            {query ? ` matching “${query}”` : " on the platform"}.
          </p>
        </div>
        {/* Desktop/tablet: inline button. Hidden on mobile (see FAB below). */}
        <Link
          href="/admin/clinics/new"
          className={cn(buttonVariants(), "hidden sm:inline-flex")}
        >
          New clinic
        </Link>
      </div>

      {metrics ? <CompanyMetricsPanel metrics={metrics} scoped={!seesAll} showRevenue={showRevenue} /> : null}

      {dueClinics.length > 0 ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4">
          <div className="mb-2 text-sm font-medium text-amber-700 dark:text-amber-400">
            {dueClinics.length} clinic{dueClinics.length === 1 ? "" : "s"} due or overdue
          </div>
          <ul className="space-y-1.5 text-sm">
            {dueClinics.slice(0, 8).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                <Link href={`/admin/clinics/${c.id}`} className="font-medium hover:underline">
                  {c.name}
                </Link>
                <span className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
                  <span>
                    {c.balance.billingStatus === "overdue"
                      ? `Rs ${c.balance.owed.toLocaleString("en-PK")} owed · ${c.balance.daysOverdue}d overdue`
                      : `due in grace · ${c.balance.daysOverdue}d past`}
                  </span>
                  <span className="text-xs">
                    {c.assignedTo === user.id
                      ? "👤 you"
                      : c.assigneeName
                        ? `👤 ${c.assigneeName}`
                        : "unassigned"}
                    {c.assigneeSuspended ? (
                      <span className="ml-1 text-warning-text">(suspended)</span>
                    ) : null}
                  </span>
                  {c.commitmentAt ? (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-400">
                      follow up{" "}
                      {new Date(c.commitmentAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      {c.commitmentNote ? ` · ${c.commitmentNote}` : ""}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {upcomingClinics.length > 0 ? (
        <div className="rounded-md border border-sky-500/40 bg-sky-500/5 p-4">
          <div className="mb-2 text-sm font-medium text-sky-700 dark:text-sky-400">
            {upcomingClinics.length} payment{upcomingClinics.length === 1 ? "" : "s"} coming up
          </div>
          <ul className="space-y-1.5 text-sm">
            {upcomingClinics.slice(0, 8).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                <Link href={`/admin/clinics/${c.id}`} className="font-medium hover:underline">
                  {c.name}
                </Link>
                <span className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
                  <span>
                    due {c.balance.paidThrough.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    {" · "}
                    {c.balance.daysRemaining === 0 ? "today" : `in ${c.balance.daysRemaining}d`}
                  </span>
                  <span className="text-xs">
                    {c.assignedTo === user.id ? "👤 you" : c.assigneeName ? `👤 ${c.assigneeName}` : "unassigned"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* WHERE the clinics are. Every row is a link into the filtered list, so the
          count and the clinics behind it can never disagree — they are one query with
          one predicate. */}
      {cityCounts.length > 0 ? (
        <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
          <div>
            <div className="mb-2 text-sm font-medium">Clinics by city</div>
            <ul className="space-y-1 text-sm">
              {cityCounts.slice(0, 8).map((c) => (
                <li key={c.cityId} className="flex items-center justify-between gap-3">
                  <Link
                    href={`/admin?city=${c.cityId}`}
                    className="truncate text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    {c.city}
                    <span className="ml-1 text-xs">· {provinceLabel(c.province)}</span>
                  </Link>
                  <span className="tabular-nums">{c.clinics}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-2 text-sm font-medium">Clinics by province</div>
            <ul className="space-y-1 text-sm">
              {provinceCounts.map((p) => (
                <li key={p.province} className="flex items-center justify-between gap-3">
                  <Link
                    href={`/admin?province=${p.province}`}
                    className="truncate text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    {provinceLabel(p.province)}
                  </Link>
                  <span className="tabular-nums">{p.clinics}</span>
                </li>
              ))}
            </ul>
            {/* Stated rather than hidden: without it every figure above reads as the
                whole picture when it is only the part we have recorded. */}
            {noCity > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {noCity} clinic{noCity === 1 ? "" : "s"} with no city recorded — not counted above.
              </p>
            ) : null}
          </div>
        </div>
      ) : noCity > 0 ? (
        <p className="rounded-lg border p-3 text-sm text-muted-foreground">
          No clinic has a city recorded yet. Set one on a clinic&apos;s Owner &amp; contact
          card and the city and province breakdowns appear here.
        </p>
      ) : null}

      <ClinicsFilters
        q={query ?? ""}
        status={statusFilter ?? ""}
        billing={billingFilter ?? ""}
        assigned={assignedFilter ?? ""}
        province={provinceFilter ?? ""}
        city={cityFilter ? String(cityFilter) : ""}
        provinceOptions={[
          { value: "", label: "All provinces" },
          ...PROVINCES.map((p) => ({ value: p.code, label: p.label })),
        ]}
        // Only cities that actually hold a clinic — the seed is 162 long and a filter
        // that can only ever return zero is noise.
        cityOptions={cityCounts.map((c) => ({ id: c.cityId, name: c.city, province: c.province }))}
        statusOptions={[
          { value: "", label: "All statuses" },
          ...CLINIC_STATUSES.map((s) => ({ value: s, label: vocabularyLabel("clinic_statuses", s) })),
        ]}
        showBilling={showBilling}
        showManager={seesAll}
        team={team}
      />
      {!seesAll ? (
        <p className="text-xs text-muted-foreground">Showing your assigned clinics.</p>
      ) : null}

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath="/admin"
        searchParams={sp}
        unit="clinic"
      />

      <ClinicsTable
        showBilling={showBilling}
        empty={
          query || statusFilter || assignedFilter
            ? "No clinics match the current filters."
            : "No clinics yet. Create the first one to enable its specialties and add its admin."
        }
        rows={allClinics.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          isYou: c.assignedTo === user.id,
          assigneeName: c.assigneeName,
          assigneeSuspended: c.assigneeSuspended,
          specialties: c.modulesEnabled.map((id) => SPECIALTY_NAME.get(id) ?? id),
          trialStartAt: c.trialStartAt,
          activatedAt: c.activatedAt,
          billingCycle: c.billingCycle,
          firstPaymentAt: firstPayments.get(c.id) ?? null,
          createdAt: c.createdAt,
        }))}
      />

      {/* Mobile: floating "+" action to add a clinic (replaces the header button). */}
      <Link
        href="/admin/clinics/new"
        aria-label="New clinic"
        className={cn(
          buttonVariants({ size: "icon" }),
          "fixed bottom-6 right-6 z-50 size-14 rounded-full shadow-lg sm:hidden",
        )}
      >
        <Plus className="size-6" aria-hidden="true" />
      </Link>
    </div>
  );
}
