import "server-only";

import { and, count, countDistinct, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointmentProcedures, appointments, users } from "@/core/db/schema";
import { procedureRowNetSql } from "@/core/appointments/procedures";
import { ACTIVE_APPT_STATUSES } from "@/core/lib/availability";
import { displayStaffName } from "@/core/types/auth";
import type { ResolvedRange } from "@/core/sales/report";
import { foldBuckets, timeKeySql } from "./report-buckets";

/**
 * Which visits a procedure counts from. "done" — COMPLETED visits, what was actually
 * performed (the default). "booked" — any live booking (cancelled and no-show excluded),
 * for "what is lined up". "all" — every booking in the range.
 */
export type ProcedureReportScope = "done" | "booked" | "all";

export type ProcedureReportFilters = {
  /** The PERFORMING doctor on the line (a doctor's own scope, or the Doctor filter). */
  doctorId?: string;
  procedureId?: string;
  scope?: ProcedureReportScope;
};

export type ProcedureReportRow = {
  name: string;
  /** Lines (times it was on a visit). */
  times: number;
  /** Σ quantity — two fillings on one line count 2. */
  qty: number;
  patients: number;
  /** Σ price × quantity, before any discount. */
  gross: number;
  /** Σ line discounts — the clinic offers these lines were booked with. */
  offers: number;
  /** gross − offers. Before any PATIENT discount, which sits on the whole bill. */
  net: number;
};

export type ProcedureReport = {
  totals: { times: number; qty: number; patients: number; gross: number; offers: number; net: number; distinct: number };
  byProcedure: ProcedureReportRow[];
  byDoctor: { doctorId: string | null; name: string; qty: number; net: number }[];
  buckets: { label: string; value: number }[];
};

/**
 * The procedures report — which procedures were done (or booked) over a range, how
 * often, for how many patients, and what they billed. CORE, clinic-scoped, aggregated
 * in SQL (ADR-025). A line's money is its SNAPSHOT (`appointment_procedures`), so a
 * later price change never rewrites this report; "net" is after the clinic offer the
 * line was booked with and before the patient discount, which belongs to the whole
 * bill rather than to any one procedure.
 */
export async function getProcedureReport(
  clinicId: string,
  range: ResolvedRange,
  f: ProcedureReportFilters,
): Promise<ProcedureReport> {
  const scope = f.scope ?? "done";
  const conds: SQL[] = [
    gte(appointments.scheduledAt, range.start),
    lt(appointments.scheduledAt, range.end),
  ];
  if (scope === "done") conds.push(eq(appointments.status, "completed"));
  else if (scope === "booked") conds.push(inArray(appointments.status, [...ACTIVE_APPT_STATUSES]));
  if (f.doctorId) conds.push(eq(appointmentProcedures.doctorId, f.doctorId));
  if (f.procedureId) conds.push(eq(appointmentProcedures.procedureId, f.procedureId));
  // Both tables are scoped: the line by byClinic, its appointment by the join + this.
  const where = byClinic(
    appointmentProcedures.clinicId,
    clinicId,
    eq(appointments.clinicId, clinicId),
    notDeleted(appointments.deletedAt),
    and(...conds),
  );
  const gross = sql<number>`coalesce(sum(${appointmentProcedures.unitPrice} * ${appointmentProcedures.quantity}), 0)::int`;
  const net = sql<number>`coalesce(sum(${procedureRowNetSql()}), 0)::int`;
  const qty = sql<number>`coalesce(sum(${appointmentProcedures.quantity}), 0)::int`;
  const join = eq(appointmentProcedures.appointmentId, appointments.id);

  const [totals, byProcedure, byDoctor, trend] = await Promise.all([
    db
      .select({
        times: count(),
        qty,
        patients: countDistinct(appointments.patientId),
        distinct: countDistinct(appointmentProcedures.name),
        gross,
        net,
      })
      .from(appointmentProcedures)
      .innerJoin(appointments, join)
      .where(where),
    // By the name SNAPSHOT, not the catalog id: a procedure renamed since is reported
    // under the name it was performed as, which is what the old invoices say too.
    db
      .select({
        name: appointmentProcedures.name,
        times: count(),
        qty,
        patients: countDistinct(appointments.patientId),
        gross,
        net,
      })
      .from(appointmentProcedures)
      .innerJoin(appointments, join)
      .where(where)
      .groupBy(appointmentProcedures.name),
    db
      .select({
        doctorId: appointmentProcedures.doctorId,
        prefix: users.prefix,
        fullName: users.fullName,
        username: users.username,
        qty,
        net,
      })
      .from(appointmentProcedures)
      .innerJoin(appointments, join)
      .leftJoin(users, eq(appointmentProcedures.doctorId, users.id))
      .where(where)
      .groupBy(appointmentProcedures.doctorId, users.prefix, users.fullName, users.username),
    db
      .select({ key: timeKeySql(appointments.scheduledAt, range), value: qty })
      .from(appointmentProcedures)
      .innerJoin(appointments, join)
      .where(where)
      .groupBy(sql`1`),
  ]);

  const t = totals[0];
  return {
    totals: {
      times: t?.times ?? 0,
      qty: t?.qty ?? 0,
      patients: t?.patients ?? 0,
      distinct: t?.distinct ?? 0,
      gross: t?.gross ?? 0,
      offers: (t?.gross ?? 0) - (t?.net ?? 0),
      net: t?.net ?? 0,
    },
    byProcedure: byProcedure
      .map((r) => ({ ...r, offers: r.gross - r.net }))
      .sort((a, b) => b.qty - a.qty || b.net - a.net),
    byDoctor: byDoctor
      .map((r) => ({
        doctorId: r.doctorId,
        name: r.doctorId ? displayStaffName(r.prefix, r.fullName, r.username ?? "") : "No doctor recorded",
        qty: r.qty,
        net: r.net,
      }))
      .sort((a, b) => b.qty - a.qty),
    buckets: foldBuckets(range, trend),
  };
}
