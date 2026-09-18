import Link from "next/link";
import { CalendarOff, CalendarRange, ChevronLeft, ChevronRight, Plus, Stethoscope, Users } from "lucide-react";
import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { getDoctorSchedule, weekStart, type ScheduleRow } from "@/core/appointments/schedule";
import { dateFromStr, localDateStr } from "@/core/appointments/availability";
import { describeAvailability } from "@/core/lib/availability";
import { buttonVariants } from "@/core/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/ui/card";
import { EmptyState } from "@/core/ui/empty-state";
import { cn } from "@/core/lib/utils";
import { LeaveCell } from "@/app/clinic/schedule/leave-cell";
import { AddLeaveButton, type LeaveDoctor } from "@/app/clinic/schedule/leave-dialog";
import { MonthSelect } from "@/app/clinic/schedule/month-select";
import { DailyLimitForm } from "@/app/clinic/schedule/daily-limit-form";

/**
 * Clinic workspace: the doctor schedule — one row per doctor, one column per day of the
 * week, showing who is working when, who is away, and how much is booked.
 *
 * It replaced a stack of per-doctor leave cards. The owner's point was that a clinic
 * needs to SEE the week before changing it: a list of leave entries answers "when is
 * Dr Sana off" but never "who is in on Thursday", which is the question the front desk
 * actually asks. Leave is still managed here — from the day it applies to.
 *
 * ONE view, a week at a time. A month grid was built and then dropped at the owner's
 * direction: thirty narrow columns of state say less than seven columns of hours.
 *
 * NOTHING scrolls sideways. The table is used from `xl` up, where eight columns fit the
 * panel; below that the same data is a card per doctor with the week as tiles. A grid
 * behind a horizontal scrollbar hides half the week, which is the half someone came to
 * look at.
 *
 * Adding leave is a BUTTON in three places — the header, each doctor, and the day
 * itself. The days were the only route at first and the owner could not find it, which
 * is fair: a clickable cell advertises nothing.
 *
 * Needs `leave` to view. A doctor is scoped to their OWN row (they may only manage
 * their own leave, which the actions re-check); admin / manager / receptionist see
 * every doctor. The daily-limit editor stays below the grid for non-doctors, which is
 * where it lived before.
 */

const DAY_MS = 86_400_000;

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Twelve months either side of the anchor, so the filter covers a planning year. */
function monthOptions(around: Date): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let i = -12; i <= 12; i++) {
    const d = new Date(around.getFullYear(), around.getMonth() + i, 1);
    out.push({
      value: monthKey(d),
      label: d.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
    });
  }
  return out;
}

const weekdayOf = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short" });
const dayMonthOf = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** Name, hours summary, cap and the doctor's own Add leave button. */
function DoctorIdentity({
  row,
  doctors,
  prefillDate,
  canCreate,
}: {
  row: ScheduleRow;
  doctors: LeaveDoctor[];
  prefillDate: string;
  canCreate: boolean;
}) {
  return (
    <span className="flex items-start gap-3">
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary-text">
        {row.initials}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{row.name}</span>
        {/* A summary, not the whole rota: the days beside it already print every
            window, and the full text ran to six lines. The title keeps the detail. */}
        <span
          className="block text-xs text-muted-foreground"
          title={row.flexible ? undefined : describeAvailability(row.availability)}
        >
          {row.flexible
            ? "No fixed hours"
            : row.availability.length === 0
              ? "No hours set"
              : `${new Set(row.availability.map((w) => w.weekday)).size} days a week`}
        </span>
        {row.dailyLimit > 0 ? (
          <span className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
            Max {row.dailyLimit}/day
          </span>
        ) : null}
        {canCreate ? (
          <span className="mt-2 block">
            <AddLeaveButton
              doctors={doctors}
              doctorId={row.doctorId}
              date={prefillDate}
              label="Add leave"
              variant="outline"
              size="sm"
              icon={<Plus className="size-3.5" aria-hidden="true" />}
            />
          </span>
        ) : null}
      </span>
    </span>
  );
}

export default async function ClinicSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const user = await requireWorkspace("schedule");
  const sp = await searchParams;
  const selfDoctorId = user.role === "doctor" ? user.id : null;

  const today = localDateStr(new Date());
  // An unparseable `from` falls back to this week rather than erroring: the URL is view
  // state, not input worth refusing over.
  const anchor = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? dateFromStr(sp.from) : new Date();
  const start = weekStart(anchor);

  const { dates, rows } = await getDoctorSchedule(user.clinicId, start, 7, {
    doctorId: selfDoctorId ?? undefined,
  });

  const canCreate = can(user, "leave", "create");
  const canDelete = can(user, "leave", "delete");
  const canSetLimit = !selfDoctorId && can(user, "schedule", "edit");
  const doctors = rows.map((r) => ({ id: r.doctorId, name: r.name }));

  const shiftWeek = (dir: 1 | -1) => localDateStr(new Date(start.getTime() + dir * 7 * DAY_MS));
  const rangeLabel = `${dayMonthOf(dates[0])} – ${dayMonthOf(dates[6])}, ${start.getFullYear()}`;

  // Everything the cards report is about the week on screen, so the figures and the
  // grid can never disagree — the alternative (always "today") would contradict the
  // grid the moment someone navigated away from this week.
  const bookedThisWeek = rows.reduce((sum, r) => sum + r.cells.reduce((s, c) => s + c.booked, 0), 0);
  const leaveDays = rows.reduce((sum, r) => sum + r.cells.filter((c) => c.onLeave).length, 0);
  const todayInView = dates.includes(today);
  const prefillDate = todayInView ? today : dates[0];
  const workingToday = rows.filter((r) =>
    r.cells.some((c) => c.date === today && !c.onLeave && (c.flexible || c.windows.length > 0)),
  ).length;
  const onLeaveToday = rows.filter((r) => r.cells.some((c) => c.date === today && c.onLeave)).length;

  const summary = [
    {
      Icon: Users,
      label: todayInView ? "In today" : "Doctors",
      value: todayInView ? `${workingToday}` : `${rows.length}`,
      note: todayInView ? `of ${rows.length} doctors` : "with a schedule",
    },
    {
      Icon: CalendarOff,
      label: todayInView ? "On leave today" : "Leave days this week",
      value: todayInView ? `${onLeaveToday}` : `${leaveDays}`,
      note: todayInView ? (onLeaveToday === 1 ? "doctor away" : "doctors away") : "across all doctors",
    },
    {
      Icon: Stethoscope,
      label: "Booked this week",
      value: `${bookedThisWeek}`,
      note: "appointments still standing",
    },
  ];

  /** The shared props of one day, in either layout. */
  const cellProps = (row: ScheduleRow, cell: ScheduleRow["cells"][number]) => ({
    doctorId: row.doctorId,
    doctorName: row.name,
    doctors,
    date: cell.date,
    dateLabel: `${weekdayOf(cell.date)} ${dayMonthOf(cell.date)}`,
    windows: cell.windows,
    flexible: cell.flexible,
    onLeave: cell.onLeave,
    leaveId: cell.leaveId,
    leaveReason: cell.leaveReason,
    booked: cell.booked,
    dailyLimit: row.dailyLimit,
    isToday: cell.date === today,
    isPast: cell.date < today,
    canCreate,
    canDelete,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">
            {selfDoctorId ? "My schedule" : "Doctor schedule"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {selfDoctorId
              ? "Your working week. Add leave, or select a day to change it."
              : "Who is in, who is away, and how much is booked. Add leave, or select a day to change it."}
          </p>
        </div>

        {canCreate && rows.length > 0 ? (
          <AddLeaveButton
            doctors={doctors}
            doctorId={selfDoctorId ?? undefined}
            date={prefillDate}
            label="Add leave"
            icon={<Plus className="size-4" aria-hidden="true" />}
          />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <MonthSelect value={monthKey(start)} months={monthOptions(start)} />
        <div className="ml-auto flex items-center gap-2">
          <Link
            href={`?from=${shiftWeek(-1)}`}
            aria-label="Previous week"
            className={cn(buttonVariants({ variant: "outline", size: "icon" }))}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Link>
          <span className="min-w-40 text-center text-sm font-medium">{rangeLabel}</span>
          <Link
            href={`?from=${shiftWeek(1)}`}
            aria-label="Next week"
            className={cn(buttonVariants({ variant: "outline", size: "icon" }))}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
          <Link
            href="/clinic/schedule"
            className={cn(buttonVariants({ variant: todayInView ? "outline" : "default" }))}
          >
            Today
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {summary.map(({ Icon, label, value, note }) => (
          <Card key={label}>
            <CardContent className="flex items-center gap-4 py-4">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary-text">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs text-muted-foreground">{label}</span>
                <span className="block text-2xl leading-tight font-semibold tabular-nums">{value}</span>
                <span className="block truncate text-xs text-muted-foreground">{note}</span>
              </span>
            </CardContent>
          </Card>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Stethoscope}
              title="No doctors yet"
              description="The week grid fills in once the clinic has doctors. A clinic admin adds them under Staff."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ---- wide screens: the week as a grid ---- */}
          <Card className="hidden overflow-hidden xl:block">
            <CardHeader className="flex-row items-center gap-2 space-y-0">
              <CalendarRange className="size-4 text-muted-foreground" aria-hidden="true" />
              <CardTitle className="text-base">{rangeLabel}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {/* `table-fixed`: seven equal day columns dividing whatever width is left,
                  so the table fits the panel instead of overflowing it. */}
              <table className="w-full table-fixed border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="w-52 border-b p-3 text-left text-xs font-medium text-muted-foreground"
                    >
                      Doctor
                    </th>
                    {dates.map((d) => (
                      <th
                        key={d}
                        scope="col"
                        className={cn(
                          "border-b p-2 text-center text-xs font-medium",
                          d === today ? "text-primary-text" : "text-muted-foreground",
                        )}
                      >
                        <span className="block">{weekdayOf(d)}</span>
                        <span className={cn("block text-sm", d === today && "font-semibold")}>
                          {dayMonthOf(d)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.doctorId} className="align-top">
                      <th scope="row" className="border-b p-3 text-left align-top font-normal">
                        <DoctorIdentity
                          row={row}
                          doctors={doctors}
                          prefillDate={prefillDate}
                          canCreate={canCreate}
                        />
                      </th>
                      {row.cells.map((cell) => (
                        // `h-px` gives the cell a height for `h-full` to resolve
                        // against, so every box in a row matches the tallest.
                        <td key={cell.date} className="h-px border-b p-1.5">
                          <LeaveCell {...cellProps(row, cell)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* ---- narrower screens: one card per doctor, the week as tiles ---- */}
          <div className="space-y-4 xl:hidden">
            {rows.map((row) => (
              <Card key={row.doctorId}>
                <CardHeader className="pb-3">
                  <DoctorIdentity
                    row={row}
                    doctors={doctors}
                    prefillDate={prefillDate}
                    canCreate={canCreate}
                  />
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {row.cells.map((cell) => (
                    <div key={cell.date} className="space-y-1">
                      <p
                        className={cn(
                          "text-xs font-medium",
                          cell.date === today ? "text-primary-text" : "text-muted-foreground",
                        )}
                      >
                        {weekdayOf(cell.date)} {dayMonthOf(cell.date)}
                      </p>
                      <LeaveCell {...cellProps(row, cell)} />
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {rows.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded border border-success/30 bg-success/20" aria-hidden="true" />
            Working
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded border border-info/30 bg-info/15" aria-hidden="true" />
            Procedure window
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded border border-destructive/40 bg-destructive/15" aria-hidden="true" />
            On leave
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded border border-dashed bg-muted" aria-hidden="true" />
            Not working
          </span>
          <span>Select any day to add or remove leave.</span>
        </p>
      ) : null}

      {canSetLimit && rows.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Daily appointment limits</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((row) => (
              <div key={row.doctorId} className="space-y-1">
                <div className="text-sm font-medium">{row.name}</div>
                <DailyLimitForm doctorId={row.doctorId} limit={row.dailyLimit} />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
