import "server-only";

import { and, count, countDistinct, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, users } from "@/core/db/schema";
import { buildAppointmentConds } from "@/core/appointments/list-query";
import { appointmentHasProceduresSql } from "@/core/appointments/procedures";
import type { StatusFilter, VisitTypeFilter } from "@/core/appointments/list-filters";
import { appointmentStatusId, type AppointmentSourceCode } from "@/core/db/vocabulary-seed";
import { SERVER_TZ } from "@/core/lib/server-tz";
import { displayStaffName } from "@/core/types/auth";
import type { ResolvedRange } from "@/core/sales/report";
import { foldBuckets, timeKeySql } from "./report-buckets";

export type AppointmentReportFilters = {
  /** A doctor's own scope, or the Doctor filter. */
  doctorId?: string;
  status?: StatusFilter;
  type?: VisitTypeFilter;
  source?: AppointmentSourceCode | "";
  procedureId?: string;
};

export type AppointmentReport = {
  total: number;
  patients: number;
  byStatus: { status: string; count: number }[];
  completed: number;
  noShow: number;
  cancelled: number;
  /** no-shows ÷ (completed + no-shows): of the visits that were EXPECTED to happen,
   *  how many did not — the same definition the no-shows screen uses. */
  noShowRate: number;
  /** cancelled ÷ all appointments in the range. */
  cancellationRate: number;
  byType: { consultation: number; procedure: number; both: number };
  bySource: { source: string; count: number }[];
  byDoctor: {
    doctorId: string | null;
    name: string;
    total: number;
    completed: number;
    noShow: number;
    cancelled: number;
  }[];
  /** 0 = Sunday … 6 = Saturday. */
  byWeekday: number[];
  /** 0 … 23, server-local. */
  byHour: number[];
  buckets: { label: string; value: number }[];
};

/**
 * The appointments report — how many were booked over a range and what became of
 * them. CORE, clinic-scoped. Filters reuse `buildAppointmentConds`, the SAME predicate
 * as the appointments list, calendar and CSV, so a count here is the count the list
 * would show for the same filters. Every figure is aggregated in SQL (ADR-025).
 */
export async function getAppointmentReport(
  clinicId: string,
  range: ResolvedRange,
  f: AppointmentReportFilters,
): Promise<AppointmentReport> {
  const conds: SQL[] = buildAppointmentConds({
    start: range.start,
    endExclusive: range.end,
    status: f.status,
    type: f.type,
    doctorId: f.doctorId,
    procedureId: f.procedureId,
  });
  if (f.source) conds.push(eq(appointments.source, f.source));
  const where = byClinic(appointments.clinicId, clinicId, notDeleted(appointments.deletedAt), and(...conds));
  // The conditions built above never name `patients` or `users` (only the list's text
  // search and payment filter do, and this report uses neither), so most queries need
  // no join; the per-doctor one joins `users` for the names.
  const statusIs = (code: Parameters<typeof appointmentStatusId>[0]) =>
    sql`${appointments.status} = ${appointmentStatusId(code)}`;
  const hasProc = appointmentHasProceduresSql();
  const local = sql`(${appointments.scheduledAt} at time zone cast(${SERVER_TZ} as text))`;

  const [totals, byStatus, byDoctor, bySource, byWeekday, byHour, trend] = await Promise.all([
    db
      .select({
        total: count(),
        patients: countDistinct(appointments.patientId),
        completed: sql<number>`count(*) filter (where ${statusIs("completed")})::int`,
        noShow: sql<number>`count(*) filter (where ${statusIs("no_show")})::int`,
        cancelled: sql<number>`count(*) filter (where ${statusIs("cancelled")})::int`,
        consultation: sql<number>`count(*) filter (where not ${hasProc})::int`,
        procedure: sql<number>`count(*) filter (where ${hasProc} and ${appointments.chargeConsultation} = false)::int`,
        both: sql<number>`count(*) filter (where ${hasProc} and ${appointments.chargeConsultation} = true)::int`,
      })
      .from(appointments)
      .where(where),
    db
      .select({ status: appointments.status, count: count() })
      .from(appointments)
      .where(where)
      .groupBy(appointments.status),
    db
      .select({
        doctorId: appointments.doctorId,
        prefix: users.prefix,
        fullName: users.fullName,
        username: users.username,
        total: count(),
        completed: sql<number>`count(*) filter (where ${statusIs("completed")})::int`,
        noShow: sql<number>`count(*) filter (where ${statusIs("no_show")})::int`,
        cancelled: sql<number>`count(*) filter (where ${statusIs("cancelled")})::int`,
      })
      .from(appointments)
      .leftJoin(users, eq(appointments.doctorId, users.id))
      .where(where)
      .groupBy(appointments.doctorId, users.prefix, users.fullName, users.username),
    db
      .select({ source: appointments.source, count: count() })
      .from(appointments)
      .where(where)
      .groupBy(appointments.source),
    db
      .select({ dow: sql<number>`extract(dow from ${local})::int`, count: count() })
      .from(appointments)
      .where(where)
      .groupBy(sql`1`),
    db
      .select({ hour: sql<number>`extract(hour from ${local})::int`, count: count() })
      .from(appointments)
      .where(where)
      .groupBy(sql`1`),
    db
      .select({ key: timeKeySql(appointments.scheduledAt, range), value: count() })
      .from(appointments)
      .where(where)
      .groupBy(sql`1`),
  ]);

  const t = totals[0];
  const total = t?.total ?? 0;
  const completed = t?.completed ?? 0;
  const noShow = t?.noShow ?? 0;
  const cancelled = t?.cancelled ?? 0;
  const weekday = Array<number>(7).fill(0);
  for (const r of byWeekday) weekday[r.dow] = r.count;
  const hours = Array<number>(24).fill(0);
  for (const r of byHour) hours[r.hour] = r.count;

  return {
    total,
    patients: t?.patients ?? 0,
    completed,
    noShow,
    cancelled,
    noShowRate: completed + noShow > 0 ? noShow / (completed + noShow) : 0,
    cancellationRate: total > 0 ? cancelled / total : 0,
    byStatus: byStatus.map((r) => ({ status: r.status, count: r.count })).sort((a, b) => b.count - a.count),
    byType: { consultation: t?.consultation ?? 0, procedure: t?.procedure ?? 0, both: t?.both ?? 0 },
    bySource: bySource.map((r) => ({ source: r.source, count: r.count })),
    byDoctor: byDoctor
      .map((r) => ({
        doctorId: r.doctorId,
        name: r.doctorId
          ? displayStaffName(r.prefix, r.fullName, r.username ?? "")
          : "No doctor assigned",
        total: r.total,
        completed: r.completed,
        noShow: r.noShow,
        cancelled: r.cancelled,
      }))
      .sort((a, b) => b.total - a.total),
    byWeekday: weekday,
    byHour: hours,
    buckets: foldBuckets(range, trend),
  };
}

