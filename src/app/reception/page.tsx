import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { and, asc, count, eq, gte, ilike, lt, or } from "drizzle-orm";
import { requireRole } from "@/core/auth/user";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { appointments, patients, users } from "@/core/db/schema";
import { Badge } from "@/core/ui/badge";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";
import { computeAppointmentTotal, formatPkr } from "@/core/appointments/fee";
import { appointmentProceduresNetSql } from "@/core/appointments/procedures";
import { getDayQueue } from "@/core/appointments/queue";
import { parseListFilters } from "@/core/appointments/list-filters";
import { pageOffset, parsePage, parsePageSize } from "@/core/lib/pagination";
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

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  confirmed: "default",
  completed: "default",
  scheduled: "secondary",
  cancelled: "destructive",
  no_show: "destructive",
};

/** Receptionist: the clinic's appointments, newest first, with quick status actions. */
export default async function ReceptionHome({
  searchParams,
}: {
  searchParams: Promise<{
    created?: string;
    updated?: string;
    from?: string;
    to?: string;
    q?: string;
    status?: string;
    session?: string;
    page?: string;
    size?: string;
  }>;
}) {
  const user = await requireRole("receptionist");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.size);
  const toastMessage = sp.created
    ? "Appointment scheduled."
    : sp.updated
      ? "Appointment updated."
      : null;
  if (!user.clinicId) {
    return (
      <p className="text-sm text-muted-foreground">
        Your account isn&apos;t linked to a clinic yet. Ask your clinic admin.
      </p>
    );
  }

  // Date range defaults to TODAY; a text query filters by patient name/phone;
  // an optional status narrows to one appointment status.
  const { fromStr, toStr, today, q, status, start, endExclusive } =
    parseListFilters(sp);

  // Clicking a "Today's queue" card sets `session` — the list then shows ONLY
  // that queue (a doctor's one visiting window), ordered by token number.
  const session = typeof sp.session === "string" ? sp.session : "";

  const conds = session
    ? [eq(appointments.queueSession, session)]
    : [gte(appointments.scheduledAt, start), lt(appointments.scheduledAt, endExclusive)];
  if (!session && q) {
    conds.push(
      or(ilike(patients.fullName, `%${q}%`), ilike(patients.phone, `%${q}%`))!,
    );
  }
  if (!session && status) conds.push(eq(appointments.status, status));

  const whereClause = byClinic(appointments.clinicId, user.clinicId, and(...conds));
  const [rows, queue, [{ total }]] = await Promise.all([
    db
      .select({
        id: appointments.id,
        scheduledAt: appointments.scheduledAt,
        status: appointments.status,
        reason: appointments.reason,
        discountType: appointments.discountType,
        discountValue: appointments.discountValue,
        chargeConsultation: appointments.chargeConsultation,
        queueNumber: appointments.queueNumber,
        patientName: patients.fullName,
        patientPhone: patients.phone,
        doctorName: users.fullName,
        doctorUsername: users.username,
        consultationFee: users.consultationFee,
        proceduresTotal: appointmentProceduresNetSql(),
      })
      .from(appointments)
      .innerJoin(patients, eq(appointments.patientId, patients.id))
      .leftJoin(users, eq(appointments.doctorId, users.id))
      .where(whereClause)
      .orderBy(session ? asc(appointments.queueNumber) : asc(appointments.scheduledAt))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    getDayQueue(user.clinicId, new Date()),
    db
      .select({ total: count() })
      .from(appointments)
      .innerJoin(patients, eq(appointments.patientId, patients.id))
      .where(whereClause),
  ]);

  const activeQueue = session ? (queue.find((s) => s.key === session) ?? null) : null;

  const fmt = (d: Date) =>
    d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  const doctorLabel = (name: string | null, username: string | null) =>
    name ?? username ?? "Any doctor";
  // Net fee (after discount) the patient pays. Null when no doctor fee applies.
  const feeLabel = (a: (typeof rows)[number]) => {
    const { gross, discount, net } = computeAppointmentTotal(
      a.chargeConsultation ? a.consultationFee : 0,
      Number(a.proceduresTotal),
      a.discountType === "percent" ? "percent" : "amount",
      a.discountValue,
    );
    if (gross === 0) return null;
    return { net: formatPkr(net), discounted: discount > 0, full: formatPkr(gross) };
  };

  const rangeLabel =
    fromStr === toStr ? (fromStr === today ? "today" : fromStr) : `${fromStr} → ${toStr}`;
  const statusLabel = status ? ` · ${status.replace("_", " ")}` : "";
  const contextLabel = session
    ? `queue · ${activeQueue ? `${activeQueue.doctorName} · ${activeQueue.windowLabel}` : "selected"}`
    : `${rangeLabel}${statusLabel}${q ? ` · “${q}”` : ""}`;

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
        <Link
          href="/reception/new"
          className={cn(buttonVariants(), "hidden sm:inline-flex")}
        >
          New appointment
        </Link>
      </div>

      <QueueSummary
        sessions={queue}
        pathname="/reception"
        activeSession={session}
      />

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
            href="/reception"
            scroll={false}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Show all appointments
          </Link>
        </div>
      ) : (
        <AppointmentFilters
          from={fromStr}
          to={toStr}
          q={q}
          status={status}
          today={today}
        />
      )}

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath="/reception"
        searchParams={sp}
        unit="appointment"
      />

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          No appointments match these filters.
        </div>
      ) : (
        <>
          {/* Desktop: full table. */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Doctor</TableHead>
                  <TableHead>Fee</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => (
                  <RowLink key={a.id} href={`/reception/appointments/${a.id}`} className="border-b">
                    <TableCell className="font-semibold tabular-nums">
                      {a.queueNumber != null ? (
                        `#${a.queueNumber}`
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{fmt(a.scheduledAt)}</TableCell>
                    <TableCell>{a.patientName}</TableCell>
                    <TableCell>{doctorLabel(a.doctorName, a.doctorUsername)}</TableCell>
                    <TableCell>
                      {(() => {
                        const f = feeLabel(a);
                        if (!f)
                          return <span className="text-muted-foreground">—</span>;
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
                      <Badge variant={STATUS_VARIANT[a.status] ?? "secondary"}>
                        {a.status.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <AppointmentActions id={a.id} status={a.status} />
                        <Link
                          href={`/reception/appointments/${a.id}`}
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

          {/* Mobile: stacked cards — no horizontal scroll; icon-only actions. */}
          <ul className="space-y-3 md:hidden">
            {rows.map((a) => (
              <RowLink
                key={a.id}
                as="li"
                href={`/reception/appointments/${a.id}`}
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
                  <Badge variant={STATUS_VARIANT[a.status] ?? "secondary"}>
                    {a.status.replace("_", " ")}
                  </Badge>
                </div>
                <div className="text-sm text-muted-foreground">
                  {fmt(a.scheduledAt)} · {doctorLabel(a.doctorName, a.doctorUsername)}
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
                  <AppointmentActions id={a.id} status={a.status} />
                  <Link
                    href={`/reception/appointments/${a.id}`}
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

      {/* Mobile FAB. */}
      <Link
        href="/reception/new"
        aria-label="New appointment"
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
