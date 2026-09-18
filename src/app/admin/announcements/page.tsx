import Link from "next/link";
import { Megaphone, Plus } from "lucide-react";
import { requireAdminCapability } from "@/core/auth/user";
import { canAdmin } from "@/core/auth/admin-permissions";
import { listAnnouncementsPage } from "@/core/admin/announcements";
import { listClinicOptions } from "@/core/clinics/options";
import { Badge } from "@/core/ui/badge";
import { buttonVariants } from "@/core/ui/button";
import { Card, CardContent } from "@/core/ui/card";
import { EmptyState } from "@/core/ui/empty-state";
import { Pagination } from "@/core/ui/pagination";
import { FlashToast } from "@/core/ui/toast";
import { cn } from "@/core/lib/utils";
import { pageOffset, parsePage, parsePageSize } from "@/core/lib/pagination";
import { vocabularyLabel, vocabularyOptions } from "@/core/db/vocabulary-cache";
import { CLINIC_STAFF_ROLES } from "@/core/types/auth";
import { AnnouncementFilters } from "./announcement-filters";
import { AnnouncementRowActions } from "./announcement-actions";

const STATES = ["showing", "scheduled", "ended", "inactive"] as const;
type State = (typeof STATES)[number];
const isState = (v: string | undefined): v is State => STATES.includes(v as State);

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const asDay = (v: string | undefined) => (v && DAY_RE.test(v.trim()) ? v.trim() : undefined);

const fmt = (d: Date) =>
  d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** Super-admin announcements — the list, with its filters, search and paging. */
export default async function AnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    state?: string;
    level?: string;
    clinic?: string;
    audience?: string;
    from?: string;
    to?: string;
    page?: string;
    size?: string;
    posted?: string;
    saved?: string;
  }>;
}) {
  const admin = await requireAdminCapability("announcements:view");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.size);
  const now = new Date();
  // Resolved ONCE and used for both the query and the "matching the filters" line.
  // They had been validated in one place and reported from another, so a value the
  // filter rejected still claimed to be filtering — which is exactly how a broken
  // date regex hid for a while: the header said filtered, the query was unfiltered.
  const from = asDay(sp.from);
  const to = asDay(sp.to);

  const [{ rows, total }, clinicList] = await Promise.all([
    listAnnouncementsPage(
      {
        q: sp.q?.trim() || undefined,
        // Narrowed, never cast: an unrecognised value drops its condition rather than
        // matching nothing and reading as "there are none".
        state: isState(sp.state) ? sp.state : undefined,
        level: sp.level?.trim() || undefined,
        clinic: sp.clinic?.trim() || undefined,
        audience: CLINIC_STAFF_ROLES.includes(sp.audience as (typeof CLINIC_STAFF_ROLES)[number])
          ? sp.audience
          : undefined,
        from,
        to,
      },
      { offset: pageOffset(page, pageSize), limit: pageSize },
      now,
    ),
    listClinicOptions(),
  ]);

  const filtered = Boolean(sp.q || sp.state || sp.level || sp.clinic || sp.audience || from || to);
  const canCreate = canAdmin(admin, "announcements:create");
  const canEdit = canAdmin(admin, "announcements:edit");

  return (
    <div className="space-y-6">
      <FlashToast message={sp.posted ? "Announcement posted." : sp.saved ? "Announcement updated." : null} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Announcements</h1>
          <p className="text-sm text-muted-foreground">
            {total} announcement{total === 1 ? "" : "s"}
            {filtered ? " matching the filters" : ""}. Each one shows in the clinic
            notice bar for the roles and dates it names.
          </p>
        </div>
        {canCreate ? (
          <Link href="/admin/announcements/new" className={cn(buttonVariants(), "hidden sm:inline-flex")}>
            New announcement
          </Link>
        ) : null}
      </div>

      <AnnouncementFilters
        q={sp.q ?? ""}
        state={isState(sp.state) ? sp.state : ""}
        level={sp.level ?? ""}
        clinic={sp.clinic ?? ""}
        audience={sp.audience ?? ""}
        from={from ?? ""}
        to={to ?? ""}
        clinics={clinicList}
        levelOptions={[
          { value: "", label: "Any level" },
          ...vocabularyOptions("announcement_levels"),
        ]}
        roleOptions={CLINIC_STAFF_ROLES.map((r) => ({
          value: r,
          label: vocabularyLabel("user_roles", r),
        }))}
      />

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath="/admin/announcements"
        searchParams={sp}
        unit="announcement"
      />

      <Card>
        <CardContent className="pt-6">
          {rows.length === 0 ? (
            <EmptyState
              icon={Megaphone}
              title={
                filtered
                  ? "No announcement matches the current filters."
                  : "No announcements yet. Post one to show a notice in the clinic notice bar."
              }
            />
          ) : (
            <ul className="divide-y">
              {rows.map((a) => {
                const notYet = a.active && a.startsAt && a.startsAt > now;
                const closed = a.active && a.endsAt && a.endsAt <= now;
                return (
                  <li key={a.id} className="flex items-start justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{a.title}</span>
                        <Badge
                          variant="outline"
                          className={
                            a.level === "warning"
                              ? "border-transparent bg-amber-500/10 text-warning-text"
                              : "border-transparent bg-sky-500/10 text-info-text"
                          }
                        >
                          {vocabularyLabel("announcement_levels", a.level)}
                        </Badge>
                        <Badge variant="secondary" title={a.clinicNames.join(", ") || undefined}>
                          {a.clinicNames.length === 0
                            ? "All clinics"
                            : a.clinicNames.length === 1
                              ? a.clinicNames[0]
                              : `${a.clinicNames.length} clinics`}
                        </Badge>
                        {/* NULL audience is every staff member, which is the norm — so
                            only a NARROWED audience is worth a badge. */}
                        {a.audience?.length ? (
                          <Badge
                            variant="outline"
                            className="border-transparent bg-violet-500/10 text-violet-700 dark:text-violet-300"
                          >
                            {a.audience.map((r) => vocabularyLabel("user_roles", r)).join(", ")} only
                          </Badge>
                        ) : null}
                        {/* "Active" only means it has not been switched off, so say when a
                            window is the reason nobody can see it. An active-looking
                            notice showing nowhere explains nothing on its own. */}
                        {!a.active ? (
                          <span className="text-xs text-muted-foreground">deactivated</span>
                        ) : notYet ? (
                          <Badge variant="outline" className="border-transparent bg-slate-500/10 text-muted-foreground">
                            scheduled
                          </Badge>
                        ) : closed ? (
                          <Badge variant="outline" className="border-transparent bg-slate-500/10 text-muted-foreground">
                            ended
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-transparent bg-emerald-500/10 text-success-text">
                            showing
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{a.body}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {a.createdByName ?? "—"} · posted {a.createdAt.toLocaleDateString()}
                        {a.startsAt ? ` · from ${fmt(a.startsAt)}` : ""}
                        {a.endsAt ? ` · until ${fmt(a.endsAt)}` : ""}
                      </p>
                    </div>
                    <AnnouncementRowActions id={a.id} active={a.active} canEdit={canEdit} />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Mobile: the header button is hidden below `sm`, so the action lives here. */}
      {canCreate ? (
        <Link
          href="/admin/announcements/new"
          aria-label="New announcement"
          className={cn(
            buttonVariants({ size: "icon" }),
            "fixed bottom-6 right-6 z-50 size-14 rounded-full shadow-lg sm:hidden",
          )}
        >
          <Plus className="size-6" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}
