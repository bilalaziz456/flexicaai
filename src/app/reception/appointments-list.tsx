import Link from "next/link";
import { ChevronRight, Download, Plus } from "lucide-react";
import { and, asc, count, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, clinics, patients, users } from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";
import { Badge } from "@/core/ui/badge";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";
import {
  computeAppointmentTotal,
  effectiveDiscountValue,
  formatPkr,
} from "@/core/appointments/fee";
import {
  appointmentHasProceduresSql,
  appointmentProceduresNetSql,
} from "@/core/appointments/procedures";
import { getDayQueue } from "@/core/appointments/queue";
import { parseListFilters } from "@/core/appointments/list-filters";
import { buildAppointmentConds } from "@/core/appointments/list-query";
import { getCalendarDays, monthBounds } from "@/core/appointments/calendar";
import { AppointmentMonth } from "./appointment-month";
import { pageOffset, parsePage, parsePageSize } from "@/core/lib/pagination";
import { displayStaffName } from "@/core/types/auth";
import { QueueSummary } from "@/core/ui/queue-summary";
import { Pagination } from "@/core/ui/pagination";
import { RowLink } from "@/core/ui/row-link";
import { FlashToast } from "@/core/ui/toast";
import { AppointmentFilters } from "./appointment-filters";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/core/ui/table";
import { AppointmentActions } from "./appointment-actions";
import { APPOINTMENT_STATUS_VARIANT, statusLabel as statusText } from "@/core/appointments/status";

export type AppointmentsListSearchParams = {
  created?: string;
  updated?: string;
  from?: string;
  to?: string;
  q?: string;
  status?: string;
  type?: string;
  payment?: string;
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

  const { fromStr, toStr, today, q, status, type, start, endExclusive } =
    parseListFilters(sp);

  const session = typeof sp.session === "string" ? sp.session : "";

  // Payment status (Paid/Partial/Unpaid) only applies when the clinic bills (sales
  // feature). It's derived from the bill vs amount_collected.
  const [clinicRow] = await db
    .select({ featuresEnabled: clinics.featuresEnabled })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
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
    doctorId: doctorScope,
  });

  const whereClause = byClinic(
    appointments.clinicId,
    clinicId,
    notDeleted(appointments.deletedAt),
    and(...conds),
  );
  // The calendar sits above the table showing the month around the current
  // range. It browses independently (`?month=`), so stepping months doesn't
  // disturb which day the table is showing.
  const month = monthBounds(parseMonth(sp.month) ?? start);
  const calCollapsed = sp.cal === "0";
  const [rows, queue, [{ total }], calendarDays] = await Promise.all([
    db
      .select({
        id: appointments.id,
        scheduledAt: appointments.scheduledAt,
        status: appointments.status,
        reason: appointments.reason,
        discountType: appointments.discountType,
        discountValue: appointments.discountValue,
        discountStatus: appointments.discountStatus,
        chargeConsultation: appointments.chargeConsultation,
        amountCollected: appointments.amountCollected,
        queueNumber: appointments.queueNumber,
        patientName: patients.fullName,
        patientPhone: patients.phone,
        doctorName: users.fullName,
        doctorUsername: users.username,
        doctorPrefix: users.prefix,
        consultationFee: users.consultationFee,
        proceduresTotal: appointmentProceduresNetSql(),
        hasProcedures: appointmentHasProceduresSql(),
      })
      .from(appointments)
      .innerJoin(patients, eq(appointments.patientId, patients.id))
      .leftJoin(users, eq(appointments.doctorId, users.id))
      .where(whereClause)
      .orderBy(session ? asc(appointments.queueNumber) : asc(appointments.scheduledAt))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    getDayQueue(clinicId, new Date(), doctorScope ? { doctorId: doctorScope } : undefined),
    db
      .select({ total: count() })
      .from(appointments)
      .innerJoin(patients, eq(appointments.patientId, patients.id))
      .where(whereClause),
    // A queue view has no date range for a calendar to sit against.
    session
      ? Promise.resolve([])
      : getCalendarDays(clinicId, month.start, month.endExclusive, {
          q,
          status,
          type,
          payment,
          doctorId: doctorScope,
        }),
  ]);

  const activeQueue = session ? (queue.find((s) => s.key === session) ?? null) : null;

  const fmt = (d: Date) =>
    d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  const doctorLabel = (a: (typeof rows)[number]) =>
    a.doctorName || a.doctorUsername
      ? displayStaffName(a.doctorPrefix, a.doctorName, a.doctorUsername ?? "")
      : "Any doctor";
  const feeLabel = (a: (typeof rows)[number]) => {
    const { gross, discount, net } = computeAppointmentTotal(
      a.chargeConsultation ? a.consultationFee : 0,
      Number(a.proceduresTotal),
      a.discountType === "percent" ? "percent" : "amount",
      effectiveDiscountValue(a.discountStatus, a.discountValue),
    );
    if (gross === 0) return null;
    return { net: formatPkr(net), discounted: discount > 0, full: formatPkr(gross) };
  };
  // Payment status of a completed visit (bill vs collected). Null when billing is
  // off or the visit isn't completed / has no bill.
  const payLabel = (
    a: (typeof rows)[number],
  ): { label: string; variant: "outline" | "secondary" | "destructive" } | null => {
    if (!billingOn || a.status !== "completed") return null;
    const bill = computeAppointmentTotal(
      a.chargeConsultation ? a.consultationFee : 0,
      Number(a.proceduresTotal),
      a.discountType === "percent" ? "percent" : "amount",
      effectiveDiscountValue(a.discountStatus, a.discountValue),
    ).net;
    if (bill <= 0) return null;
    const left = bill - a.amountCollected;
    if (left <= 0) return { label: "Paid", variant: "outline" };
    if (a.amountCollected > 0) return { label: `Partial · ${formatPkr(left)} left`, variant: "secondary" };
    return { label: "Unpaid", variant: "destructive" };
  };
  // What the visit is FOR: consultation (fee, no procedures) · procedure (procedures,
  // consultation not charged) · both. Mirrors the `type` filter's SQL derivation.
  const typeInfo = (
    a: (typeof rows)[number],
  ): { label: string; variant: "default" | "secondary" | "outline" } => {
    if (a.hasProcedures && a.chargeConsultation) return { label: "Both", variant: "default" };
    if (a.hasProcedures) return { label: "Procedure", variant: "secondary" };
    return { label: "Consultation", variant: "outline" };
  };

  const rangeLabel =
    fromStr === toStr ? (fromStr === today ? "today" : fromStr) : `${fromStr} → ${toStr}`;
  const statusLabel = status ? ` · ${status.replace("_", " ")}` : "";
  const typeLabel = type ? ` · ${type}` : "";
  const contextLabel = session
    ? `queue · ${activeQueue ? `${activeQueue.doctorName} · ${activeQueue.windowLabel}` : "selected"}`
    : `${rangeLabel}${statusLabel}${typeLabel}${q ? ` · “${q}”` : ""}`;

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Appointments</h1>
          <p className="text-sm text-muted-foreground">
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
            <Link href={newHref} className={cn(buttonVariants(), "hidden sm:inline-flex")}>
              New appointment
            </Link>
          ) : null}
        </div>
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
          selectedFrom={fromStr}
          selectedTo={toStr}
        />
      ) : null}

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath={listPath}
        searchParams={sp}
        unit="appointment"
      />

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          No appointments match these filters.
        </div>
      ) : (
        <>
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
                          {statusText(a.status)}
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

          <ul className="space-y-3 md:hidden">
            {rows.map((a) => (
              <RowLink
                key={a.id}
                as="li"
                href={`${detailBase}/${a.id}`}
                className="block space-y-2 rounded-md border p-3"
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
                      {statusText(a.status)}
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
        </>
      )}

      {canCreate ? (
        <Link
          href={newHref}
          aria-label="New appointment"
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
