import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { and, count, desc, eq, ilike, isNull } from "drizzle-orm";
import { db } from "@/core/db";
import { notDeleted } from "@/core/db/tenant";
import { clinics, users } from "@/core/db/schema";
import { SPECIALTY_CATALOG } from "@/config/modules";
import { CLINIC_STATUSES, CLINIC_STATUS_LABEL, isClinicStatus } from "@/core/clinics/status";
import { requireRole } from "@/core/auth/user";
import { canAdmin, canSeeBilling } from "@/core/auth/admin-permissions";
import { listDueClinics } from "@/core/admin/billing";
import { getCompanyMetrics } from "@/core/admin/metrics";
import { ClinicStatusBadge } from "./clinics/status-badge";
import { CompanyMetricsPanel } from "./company-metrics";
import { buttonVariants } from "@/core/ui/button";
import { Badge } from "@/core/ui/badge";
import { cn } from "@/core/lib/utils";
import { pageOffset, parsePage, parsePageSize } from "@/core/lib/pagination";
import { Pagination } from "@/core/ui/pagination";
import { FlashToast } from "@/core/ui/toast";
import { RowLink } from "@/core/ui/row-link";
import { ClinicsSearch } from "./clinics-search";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/core/ui/table";

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
    created?: string;
    updated?: string;
    deleted?: string;
    assigned?: string;
  }>;
}) {
  const user = await requireRole("super_admin");
  const sp = await searchParams;
  const query = sp.q?.trim();
  const statusFilter = sp.status && isClinicStatus(sp.status) ? sp.status : undefined;
  // Assigned-to filter: "me" · "unassigned" · a team-member id.
  const assignedFilter = sp.assigned?.trim() || undefined;
  const assignedWhere =
    assignedFilter === "unassigned"
      ? isNull(clinics.assignedTo)
      : assignedFilter === "me"
        ? eq(clinics.assignedTo, user.id)
        : assignedFilter
          ? eq(clinics.assignedTo, assignedFilter)
          : undefined;
  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.size);
  const toastMessage = sp.created
    ? "Clinic created."
    : sp.updated
      ? "Clinic updated."
      : sp.deleted
        ? "Clinic deleted."
        : null;

  // Super-admin clinic list excludes trashed clinics (they live in the admin Trash).
  const where = and(
    notDeleted(clinics.deletedAt),
    query ? ilike(clinics.name, `%${query}%`) : undefined,
    statusFilter ? eq(clinics.status, statusFilter) : undefined,
    assignedWhere,
  );
  // The full financial panel is `metrics:view`; the due/overdue list is billing
  // VISIBILITY (owner + sales + billing + support see it). Feature 9.
  const showMetrics = canAdmin(user, "metrics:view");
  const showBilling = canSeeBilling(user);
  const [clinicRows, [{ total }], dueClinics, metrics] = await Promise.all([
    db
      .select({ clinic: clinics, assigneeName: users.fullName, assigneeUsername: users.username })
      .from(clinics)
      .leftJoin(users, eq(clinics.assignedTo, users.id))
      .where(where)
      .orderBy(desc(clinics.createdAt))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    db.select({ total: count() }).from(clinics).where(where),
    showBilling ? listDueClinics() : Promise.resolve([]),
    showMetrics ? getCompanyMetrics() : Promise.resolve(null),
  ]);
  const allClinics = clinicRows.map((r) => ({
    ...r.clinic,
    assigneeName: r.assigneeName ?? r.assigneeUsername,
  }));

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

      {metrics ? <CompanyMetricsPanel metrics={metrics} /> : null}

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

      <ClinicsSearch initial={query ?? ""} />

      {/* Status filter — preserves the current search query + assignee filter. */}
      <div className="flex flex-wrap gap-1.5">
        {[{ id: undefined, label: "All" }, ...CLINIC_STATUSES.map((s) => ({ id: s, label: CLINIC_STATUS_LABEL[s] }))].map(
          (opt) => {
            const active = statusFilter === opt.id || (!statusFilter && opt.id === undefined);
            const params = new URLSearchParams();
            if (query) params.set("q", query);
            if (opt.id) params.set("status", opt.id);
            if (assignedFilter) params.set("assigned", assignedFilter);
            const href = params.toString() ? `/admin?${params.toString()}` : "/admin";
            return (
              <Link
                key={opt.label}
                href={href}
                className={cn(
                  buttonVariants({ variant: active ? "default" : "outline", size: "sm" }),
                  "h-7 px-2.5 text-xs",
                )}
              >
                {opt.label}
              </Link>
            );
          },
        )}
      </div>

      {/* Assigned-to filter (account manager). */}
      <div className="flex flex-wrap gap-1.5">
        {[
          { id: undefined, label: "Any manager" },
          { id: "me", label: "My clinics" },
          { id: "unassigned", label: "Unassigned" },
        ].map((opt) => {
          const active = assignedFilter === opt.id || (!assignedFilter && opt.id === undefined);
          const params = new URLSearchParams();
          if (query) params.set("q", query);
          if (statusFilter) params.set("status", statusFilter);
          if (opt.id) params.set("assigned", opt.id);
          const href = params.toString() ? `/admin?${params.toString()}` : "/admin";
          return (
            <Link
              key={opt.label}
              href={href}
              className={cn(
                buttonVariants({ variant: active ? "default" : "outline", size: "sm" }),
                "h-7 px-2.5 text-xs",
              )}
            >
              {opt.label}
            </Link>
          );
        })}
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath="/admin"
        searchParams={sp}
        unit="clinic"
      />

      {allClinics.length === 0 ? (
        <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          {query || statusFilter || assignedFilter
            ? "No clinics match the current filters."
            : "No clinics yet. Create the first one to enable its specialties and add its admin."}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Clinic</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Assigned to</TableHead>
              <TableHead>Specialties</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Manage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {allClinics.map((clinic) => (
              <RowLink key={clinic.id} href={`/admin/clinics/${clinic.id}`} className="border-b">
                <TableCell className="font-medium">{clinic.name}</TableCell>
                <TableCell>
                  <ClinicStatusBadge status={clinic.status} />
                </TableCell>
                <TableCell className="text-sm">
                  {clinic.assignedTo === user.id ? (
                    <span className="font-medium">You</span>
                  ) : clinic.assigneeName ? (
                    clinic.assigneeName
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {clinic.modulesEnabled.length === 0 ? (
                      <span className="text-muted-foreground">None</span>
                    ) : (
                      clinic.modulesEnabled.map((id) => (
                        <Badge key={id} variant="secondary">
                          {SPECIALTY_NAME.get(id) ?? id}
                        </Badge>
                      ))
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {clinic.createdAt.toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/admin/clinics/${clinic.id}`}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                  >
                    Open
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </Link>
                </TableCell>
              </RowLink>
            ))}
          </TableBody>
        </Table>
      )}

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
