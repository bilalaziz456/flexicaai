import "server-only";

import { and, desc, eq, gte, ilike, lt, or, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, patients, users } from "@/core/db/schema";
import { appointmentProceduresNetSql } from "@/core/appointments/procedures";
import { displayStaffName } from "@/core/types/auth";

/**
 * Receivables (Finance) — what patients OWE the clinic: the outstanding balance on
 * COMPLETED visits (bill − collected), the same rule as the dashboard "Outstanding"
 * KPI, so the totals reconcile. Grouped by patient with a per-visit drill-in. The
 * bill net mirrors computeAppointmentTotal. Clinic-scoped.
 */

/**
 * The bill net SQL for an appointment (consultation + procedures − approval-gated
 * discount), mirroring computeAppointmentTotal. The single source of the "bill"
 * expression — the dashboard's outstanding KPI (`getFinanceKpis`) reuses it so the
 * two always reconcile. Requires `users` joined on the appointment's doctor.
 */
export function appointmentBillNetSql() {
  const effDiscount = sql`(case when ${appointments.discountStatus} in ('pending','rejected') then 0 else ${appointments.discountValue} end)`;
  const subtotal = sql`((case when ${appointments.chargeConsultation} then coalesce(${users.consultationFee}, 0) else 0 end) + ${appointmentProceduresNetSql()})`;
  return sql<number>`(${subtotal} - least(greatest(case when ${appointments.discountType} = 'percent' then round(${subtotal} * ${effDiscount} / 100.0) else ${effDiscount} end, 0), ${subtotal}))`;
}

/** Total outstanding receivable across all completed visits (matches the dashboard). */
export async function getOutstandingTotal(clinicId: string): Promise<number> {
  const net = appointmentBillNetSql();
  const [row] = await db
    .select({ v: sql<number>`coalesce(sum(greatest(${net} - ${appointments.amountCollected}, 0)), 0)::int` })
    .from(appointments)
    .leftJoin(users, eq(users.id, appointments.doctorId))
    .where(byClinic(appointments.clinicId, clinicId, notDeleted(appointments.deletedAt), eq(appointments.status, "completed")));
  return Number(row?.v ?? 0);
}

export type ReceivableVisit = {
  appointmentId: string;
  scheduledAt: Date;
  doctorName: string | null;
  bill: number;
  collected: number;
  outstanding: number;
};
export type ReceivablePatient = {
  patientId: string;
  name: string;
  phone: string | null;
  billed: number;
  collected: number;
  outstanding: number;
  visits: ReceivableVisit[];
};
export type ReceivablesReport = {
  total: number;
  patientCount: number;
  patients: ReceivablePatient[];
};

export type ReceivablesFilters = {
  doctorId?: string;
  q?: string;
  from?: Date;
  toExclusive?: Date;
};

export async function getReceivablesReport(
  clinicId: string,
  filters: ReceivablesFilters = {},
): Promise<ReceivablesReport> {
  const net = appointmentBillNetSql();
  const conds = [eq(appointments.status, "completed"), sql`${net} > ${appointments.amountCollected}`];
  if (filters.doctorId) conds.push(eq(appointments.doctorId, filters.doctorId));
  if (filters.q) conds.push(or(ilike(patients.fullName, `%${filters.q}%`), ilike(patients.phone, `%${filters.q}%`))!);
  if (filters.from) conds.push(gte(appointments.scheduledAt, filters.from));
  if (filters.toExclusive) conds.push(lt(appointments.scheduledAt, filters.toExclusive));

  const rows = await db
    .select({
      appointmentId: appointments.id,
      scheduledAt: appointments.scheduledAt,
      bill: net,
      collected: appointments.amountCollected,
      patientId: patients.id,
      patientName: patients.fullName,
      patientPhone: patients.phone,
      doctorPrefix: users.prefix,
      doctorName: users.fullName,
      doctorUsername: users.username,
    })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .leftJoin(users, eq(users.id, appointments.doctorId))
    .where(byClinic(appointments.clinicId, clinicId, notDeleted(appointments.deletedAt), and(...conds)))
    .orderBy(desc(appointments.scheduledAt));

  const map = new Map<string, ReceivablePatient>();
  for (const r of rows) {
    const bill = Number(r.bill);
    const outstanding = Math.max(0, bill - r.collected);
    if (outstanding <= 0) continue;
    let p = map.get(r.patientId);
    if (!p) {
      p = { patientId: r.patientId, name: r.patientName, phone: r.patientPhone, billed: 0, collected: 0, outstanding: 0, visits: [] };
      map.set(r.patientId, p);
    }
    p.billed += bill;
    p.collected += r.collected;
    p.outstanding += outstanding;
    p.visits.push({
      appointmentId: r.appointmentId,
      scheduledAt: r.scheduledAt,
      doctorName:
        r.doctorName || r.doctorUsername
          ? displayStaffName(r.doctorPrefix, r.doctorName, r.doctorUsername ?? "")
          : null,
      bill,
      collected: r.collected,
      outstanding,
    });
  }

  const patientsList = [...map.values()].sort((a, b) => b.outstanding - a.outstanding);
  return {
    total: patientsList.reduce((s, p) => s + p.outstanding, 0),
    patientCount: patientsList.length,
    patients: patientsList,
  };
}
