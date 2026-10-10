import { listClinicAppointments } from "@/core/appointments/list-query";
import { TableCard } from "@/core/ui/table-card";
import Link from "next/link";
import { ChevronRight, Download, CalendarSearch, Printer } from "lucide-react";
import { getClinic } from "@/core/clinics/get-clinic";
import { clinicHasFeature } from "@/core/lib/features";
import { Badge } from "@/core/ui/badge";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";
import { EmptyState } from "@/core/ui/empty-state";
import { getDayQueue } from "@/core/appointments/queue";
import { parseListFilters } from "@/core/appointments/list-filters";
import { buildAppointmentConds } from "@/core/appointments/list-query";
import { getCalendarDays, monthBounds } from "@/core/appointments/calendar";
import { listClinicDoctors } from "@/core/appointments/doctors";
import { listProcedureCatalog } from "@/core/appointments/procedures";
import { AppointmentMonth } from "@/app/clinic/appointments/appointment-month";
import {
  HEADER_SENTINEL_ID,
  NewAppointmentFab,
} from "@/app/clinic/appointments/new-appointment-fab";
import { pageOffset, parsePage, parsePageSize } from "@/core/lib/pagination";
import { QueueSummary } from "@/core/ui/queue-summary";
import { Pagination } from "@/core/ui/pagination";
import { RowLink } from "@/core/ui/row-link";
import { FlashToast } from "@/core/ui/toast";
import { AppointmentFilters } from "@/app/clinic/appointments/appointment-filters";
import {
  appointmentDoctorLabel,
  appointmentFeeLabel,
  appointmentPayLabel,
  appointmentTypeInfo,
  formatWhen,
  type AppointmentRow,
} from "@/app/clinic/appointments/row-format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/core/ui/table";
import { AppointmentActions } from "@/app/clinic/appointments/appointment-actions";
import { APPOINTMENT_STATUS_VARIANT } from "@/core/appointments/status";
import { vocabularyLabel } from "@/core/db/vocabulary-cache";

export type AppointmentsListSearchParams = {
  created?: string;
  updated?: string;
  from?: string;
  to?: string;
  q?: string;
  status?: string;
  type?: string;
  payment?: string;
  /** Doctor filter (a user id). Ignored for a viewer who has a doctor SCOPE. */
  doctor?: string;
  /** Procedure filter (a catalog procedure id). */
  procedure?: string;
  session?: string;
  /** "YYYY-MM" — which month the calendar shows. Independent of from/to so
   *  browsing months doesn't change which day the table lists. */
  month?: string;
  /** "0" folds the calendar to one line so the table sits above the fold. */
  cal?: string;
  page?: string;
  size?: string;
};

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Local midnight on the 1st of a "YYYY-MM", or null when absent/malformed. */
function parseMonth(value: string | undefined): Date | null {
  if (!value || !YM.test(value)) return null;
  const [y, m] = value.split("-").map(Number);
  return new Date(y, m - 1, 1);
}
const toYm = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/**
 * The clinic's appointments list — shared by the receptionist panel and any other
 * panel that surfaces appointments (e.g. a doctor granted the `appointments`
 * permission). Paths are parameterised so it can mount under different routes;
 * `canCreate` / `canEdit` come from the caller's permission check.
 */
export async function AppointmentsList({
  clinicId,
  canCreate,
  canEdit,
  listPath,
  detailBase,
  newHref,
  searchParams,
  doctorScope,
}: {
  clinicId: string;
  canCreate: boolean;
  canEdit: boolean;
  /** Route for pagination / queue / "show all" (e.g. "/reception"). */
  listPath: string;
  /** Base for a row's detail link (e.g. "/reception/appointments"). */
  detailBase: string;
  /** Href for the "New appointment" button. */
  newHref: string;
  searchParams: AppointmentsListSearchParams;
  /** Limit every figure on this screen to one doctor (a doctor viewing their own
   *  schedule). Comes from `appointmentDoctorScope`, never from the URL. */
  doctorScope?: string;
}) {
  const sp = searchParams;
  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.size);
  const toastMessage = sp.created
    ? "Appointment scheduled."
    : sp.updated
      ? "Appointment updated."
      : null;

  const { fromStr, toStr, today, q, status, type, doctor, procedure, start, endExclusive } =
    parseListFilters(sp);

  // The Doctor filter. A viewer with a SCOPE (a doctor) never sees it: their scope
  // already pins every figure to them. For everyone else the requested id must be a
  // doctor of THIS clinic — anything else is dropped rather than matching nothing,
  // so a stale bookmark shows the whole clinic instead of an empty screen.
  const doctors = doctorScope ? [] : await listClinicDoctors(clinicId);
  const pickedDoctor = doctors.find((d) => d.id === doctor);
  const doctorId = doctorScope ?? pickedDoctor?.id;

  // The Procedure filter offers the clinic's catalog — retired procedures too, since
  // past visits still carry them and "who had a scaling last year" is a fair question.
  // Same rule as the doctor: an id that is not this clinic's is dropped.
  const catalog = await listProcedureCatalog(clinicId);
  const procedureOptions = [...catalog]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ value: p.id, label: p.isActive ? p.name : `${p.name} (retired)` }));
  const pickedProcedure = catalog.find((p) => p.id === procedure);
  const procedureId = pickedProcedure?.id;

  const session = typeof sp.session === "string" ? sp.session : "";

  /**
   * "New appointment" carries the day the list is showing, so clicking a date in the
   * calendar and then New opens the form with that date already chosen.
   *
   * Only when ONE day is selected. A multi-day range has no single intended date, and
   * guessing `from` would quietly book into a day the user did not pick — an empty
   * field is the honest answer there.
   *
   * Skipped in a QUEUE SESSION view too, and that one matters: a session pins its own
   * doctor and day, but `fromStr` is not applied in that view and still reads today —
   * so prefilling from it would offer today while the screen shows another date.
   */
  const bookHref =
    !session && fromStr === toStr ? `${newHref}?date=${fromStr}` : newHref;

  // Payment status (Paid/Partial/Unpaid) only applies when the clinic bills (sales
  // feature). It's derived from the bill vs amount_collected.
  const clinicRow = await getClinic(clinicId);
  const billingOn = clinicHasFeature(clinicRow?.featuresEnabled, "sales");
  const payment = billingOn && typeof sp.payment === "string" ? sp.payment : "";

  // Carry the active filters onto the CSV export link so the download matches the list.
  const exportParams = new URLSearchParams();
  if (session) exportParams.set("session", session);
  else {
    exportParams.set("from", fromStr);
    exportParams.set("to", toStr);
  }
  if (q) exportParams.set("q", q);
  if (status) exportParams.set("status", status);
  if (type) exportParams.set("type", type);
  if (payment) exportParams.set("payment", payment);
  if (pickedDoctor) exportParams.set("doctor", pickedDoctor.id);
  if (procedureId) exportParams.set("procedure", procedureId);

  // A queue session pins the doctor + day + window (ordered by token); the date
  // range applies only in the normal list. The other filters (search, status,
  // type, payment) narrow BOTH views — so selecting a doctor's queue still
  // filters. Shared with the CSV export and the month calendar.
  const conds = buildAppointmentConds({
    session,
    start,
    endExclusive,
    q,
    status,
    type,
    payment,
    doctorId,
    procedureId,
  });

  // The calendar sits above the table showing the month around the current
  // range. It browses independently (`?month=`), so stepping months doesn't
  // disturb which day the table is showing.
  const month = monthBounds(parseMonth(sp.month) ?? start);
  const calCollapsed = sp.cal === "0";
  const [{ rows, total }, queue, calendarDays] = await Promise.all([
    listClinicAppointments(
      clinicId,
      conds,
      { offset: pageOffset(page, pageSize), limit: pageSize },
      { byQueueNumber: Boolean(session) },
    ),
    getDayQueue(clinicId, new Date(), doctorId ? { doctorId } : undefined),
    // A queue view has no date range for a calendar to sit against.
    session
      ? Promise.resolve([])
      : getCalendarDays(clinicId, month.start, month.endExclusive, {
          q,
          status,
          type,
          payment,
          doctorId,
          procedureId,
        }, doctorScope ? undefined : doctors),
  ]);

  const activeQueue = session ? (queue.find((s) => s.key === session) ?? null) : null;

  const fmt = formatWhen;
  const doctorLabel = appointmentDoctorLabel;
  const feeLabel = appointmentFeeLabel;
  const payLabel = (a: AppointmentRow) => appointmentPayLabel(a, billingOn);
  const typeInfo = appointmentTypeInfo;

  const rangeLabel =
    fromStr === toStr ? (fromStr === today ? "today" : fromStr) : `${fromStr} → ${toStr}`;
  const statusLabel = status ? ` · ${status.replace("_", " ")}` : "";
  const typeLabel = type ? ` · ${type}` : "";
  const contextLabel = session
    ? `queue · ${activeQueue ? `${activeQueue.doctorName} · ${activeQueue.windowLabel}` : "selected"}`
    : `${rangeLabel}${statusLabel}${typeLabel}${pickedDoctor ? ` · ${pickedDoctor.name}` : ""}${pickedProcedure ? ` · ${pickedProcedure.name}` : ""}${q ? ` · “${q}”` : ""}`;

  // Calendar links keep every other filter exactly as the user set it — a day
  // click only moves the date range, a month step only moves `month`.
  const calendarHref = (next: {
    from?: string;
    to?: string;
    month?: string;
    collapsed?: boolean;
  }) => {
    const params = new URLSearchParams();
    params.set("from", next.from ?? fromStr);
    params.set("to", next.to ?? toStr);
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (type) params.set("type", type);
    if (payment) params.set("payment", payment);
    if (pickedDoctor) params.set("doctor", pickedDoctor.id);
    if (procedureId) params.set("procedure", procedureId);
    if (next.month) params.set("month", next.month);
    if (next.collapsed ?? calCollapsed) params.set("cal", "0");
    return `${listPath}?${params.toString()}`;
  };
  const stepMonth = (delta: number) => {
    const d = new Date(month.start.getFullYear(), month.start.getMonth() + delta, 1);
    return calendarHref({ month: toYm(d) });
  };

  return (
    <div className="space-y-6">
      <FlashToast message={toastMessage} />
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Appointments</h1>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            {total} appointment{total === 1 ? "" : "s"} · {contextLabel}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {total > 0 ? (
            <a
              href={`/api/appointments/export?${exportParams.toString()}`}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              <Download className="size-4" aria-hidden="true" /> CSV
            </a>
          ) : null}
          {canCreate ? (
            <Link href={bookHref} className={cn(buttonVariants(), "hidden sm:inline-flex")}>
              New appointment
            </Link>
          ) : null}
        </div>
        {/* Marker the floating button watches: once THIS leaves the viewport the header
            button is gone, so the floating one takes over. A zero-height element rather
            than observing the button itself, which does not exist below `sm`.
            ABSOLUTE, pinned to the header's bottom edge: as a normal sibling it took a
            `space-y-6` slot of its own, so the heading sat two gaps away from the
            filters instead of the one every other page has. */}
        <div
          id={HEADER_SENTINEL_ID}
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-px"
        />
      </div>

      <QueueSummary sessions={queue} pathname={listPath} activeSession={session} />

      {session ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/40 bg-accent/40 p-3 text-sm">
          <span>
            Showing queue:{" "}
            <span className="font-medium">
              {activeQueue
                ? `${activeQueue.doctorName} · ${activeQueue.windowLabel}`
                : "selected queue"}
            </span>
          </span>
          <Link
            href={listPath}
            scroll={false}
            className="inline-flex min-h-6 items-center font-medium text-primary-text underline-offset-4 hover:underline"
          >
            Show all appointments
          </Link>
        </div>
      ) : null}

      {/* Filters stay visible even inside a doctor's queue — they narrow within it.
          The date range only makes sense for the full list, so it's hidden in a queue
          (the session already pins the day), and `session` is preserved on change. */}
      <AppointmentFilters
        from={fromStr}
        to={toStr}
        q={q}
        status={status}
        type={type}
        payment={payment}
        showPayment={billingOn}
        today={today}
        session={session}
        month={sp.month && calendarDays.length > 0 ? toYm(month.start) : ""}
        calCollapsed={calCollapsed}
        doctor={pickedDoctor?.id ?? ""}
        doctorOptions={doctors.map((d) => ({ value: d.id, label: d.name }))}
        procedure={procedureId ?? ""}
        procedureOptions={procedureOptions}
      />

      {/* The month at a glance, above the table it filters. Hover a day for the
          visit-type breakdown and which doctors are visiting (with hours);
          click one to list that date below. */}
      {calendarDays.length > 0 ? (
        <AppointmentMonth
          days={calendarDays}
          today={today}
          monthLabel={month.start.toLocaleDateString("en-GB", {
            month: "long",
            year: "numeric",
          })}
          collapsed={calCollapsed}
          toggleHref={calendarHref({ month: toYm(month.start), collapsed: !calCollapsed })}
          prevHref={stepMonth(-1)}
          nextHref={stepMonth(1)}
          todayHref={calendarHref({ from: today, to: today, month: toYm(new Date()) })}
          dayHref={(date) => calendarHref({ from: date, to: date, month: toYm(month.start) })}
          bookHref={canCreate ? (date) => `${newHref}?date=${date}` : undefined}
          filterLabel={[pickedDoctor?.name, pickedProcedure?.name].filter(Boolean).join(" · ") || undefined}
          selectedFrom={fromStr}
          selectedTo={toStr}
        />
      ) : null}

      {/* Print sits on the pagination line because it answers the same question —
          "what is this list?" — and prints ALL of it, not the page showing: a
          printed day list that silently stops at row 20 is worse than none. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            basePath={listPath}
            searchParams={sp}
            unit="appointment"
          />
        </div>
        {total > 0 ? (
          <a
            href={`${listPath}/print?${exportParams.toString()}`}
            target="_blank"
            rel="noopener"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <Printer className="size-4" aria-hidden="true" /> Print (A4)
          </a>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={CalendarSearch}
          title="No appointments here"
          description="Nothing matches the current filters. Widen the date range, or clear a filter to see more."
        />
      ) : (
        <TableCard>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Doctor</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Fee</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => (
                  <RowLink key={a.id} href={`${detailBase}/${a.id}`} className="border-b">
                    <TableCell className="font-semibold tabular-nums">
                      {a.queueNumber != null ? (
                        `#${a.queueNumber}`
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{fmt(a.scheduledAt)}</TableCell>
                    <TableCell>{a.patientName}</TableCell>
                    <TableCell>{doctorLabel(a)}</TableCell>
                    <TableCell>
                      {(() => {
                        const t = typeInfo(a);
                        return <Badge variant={t.variant}>{t.label}</Badge>;
                      })()}
                      {/* What the visit is for, by name — the badge alone says only
                          "Procedure", which is the question the desk is asked. */}
                      {a.procedureNames ? (
                        <span className="mt-1 block max-w-[16rem] text-xs text-muted-foreground">
                          {a.procedureNames}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const f = feeLabel(a);
                        if (!f) return <span className="text-muted-foreground">—</span>;
                        return (
                          <span className="whitespace-nowrap">
                            <span className="font-medium">{f.net}</span>
                            {f.discounted ? (
                              <span className="ml-1 text-xs text-muted-foreground line-through">
                                {f.full}
                              </span>
                            ) : null}
                          </span>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={APPOINTMENT_STATUS_VARIANT[a.status] ?? "secondary"}>
                          {vocabularyLabel("appointment_statuses", a.status)}
                        </Badge>
                        {(() => {
                          const p = payLabel(a);
                          return p ? <Badge variant={p.variant}>{p.label}</Badge> : null;
                        })()}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {canEdit ? <AppointmentActions id={a.id} status={a.status} /> : null}
                        <Link
                          href={`${detailBase}/${a.id}`}
                          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                        >
                          Open
                          <ChevronRight className="size-4" aria-hidden="true" />
                        </Link>
                      </div>
                    </TableCell>
                  </RowLink>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="divide-y divide-border/60 rounded-lg border border-border/60 md:hidden">
            {rows.map((a) => (
              <RowLink
                key={a.id}
                as="li"
                href={`${detailBase}/${a.id}`}
                className="block space-y-2 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-medium">
                    {a.queueNumber != null ? (
                      <span className="rounded-md bg-accent px-1.5 py-0.5 text-xs font-semibold tabular-nums text-accent-foreground">
                        #{a.queueNumber}
                      </span>
                    ) : null}
                    {a.patientName}
                  </span>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <Badge variant={APPOINTMENT_STATUS_VARIANT[a.status] ?? "secondary"}>
                      {vocabularyLabel("appointment_statuses", a.status)}
                    </Badge>
                    {(() => {
                      const p = payLabel(a);
                      return p ? <Badge variant={p.variant}>{p.label}</Badge> : null;
                    })()}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(() => {
                    const t = typeInfo(a);
                    return <Badge variant={t.variant}>{t.label}</Badge>;
                  })()}
                  {a.procedureNames ? (
                    <span className="text-xs text-muted-foreground">{a.procedureNames}</span>
                  ) : null}
                </div>
                <div className="text-sm text-muted-foreground">
                  {fmt(a.scheduledAt)} · {doctorLabel(a)}
                  {a.reason ? ` · ${a.reason}` : ""}
                </div>
                {(() => {
                  const f = feeLabel(a);
                  if (!f) return null;
                  return (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Fee: </span>
                      <span className="font-medium">{f.net}</span>
                      {f.discounted ? (
                        <span className="ml-1 text-xs text-muted-foreground line-through">
                          {f.full}
                        </span>
                      ) : null}
                    </div>
                  );
                })()}
                <div className="flex flex-wrap items-center gap-2">
                  {canEdit ? <AppointmentActions id={a.id} status={a.status} /> : null}
                  <Link
                    href={`${detailBase}/${a.id}`}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                  >
                    Open
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </Link>
                </div>
              </RowLink>
            ))}
          </ul>
        </TableCard>
      )}

      {canCreate ? <NewAppointmentFab href={bookHref} /> : null}
    </div>
  );
}
