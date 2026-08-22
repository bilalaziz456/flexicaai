import "server-only";

import { and, desc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointmentNetSql } from "@/core/appointments/bill-sql";
import { appointments, patientPayments, patients, users } from "@/core/db/schema";
import { displayStaffName } from "@/core/types/auth";

/**
 * Net opening balance (imported pre-FlexicaAI dues) still owed for a clinic — the sum
 * of `patients.opening_balance` minus any `opening` payments recorded against it.
 * Floored at 0. Shared by the KPI + the receivables report.
 */
async function openingOwed(clinicId: string): Promise<number> {
  const [open] = await db
    .select({ v: sql<number>`coalesce(sum(${patients.openingBalance}), 0)::int` })
    .from(patients)
    .where(byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt)));
  const [paid] = await db
    .select({ v: sql<number>`coalesce(sum(${patientPayments.amount}), 0)::int` })
    .from(patientPayments)
    .where(byClinic(patientPayments.clinicId, clinicId, notDeleted(patientPayments.deletedAt), eq(patientPayments.kind, "opening")));
  return Math.max(0, Number(open?.v ?? 0) - Number(paid?.v ?? 0));
}

/**
 * Receivables (Finance) — what patients OWE the clinic: the outstanding balance on
 * COMPLETED visits (bill − collected), the same rule as the dashboard "Outstanding"
 * KPI, so the totals reconcile. Grouped by patient with a per-visit drill-in. The
 * bill net mirrors computeAppointmentTotal. Clinic-scoped.
 */

// The bill expression lives in `core/appointments/bill-sql`. This module used to
// carry a byte-identical copy of it, and `list-query.ts` a third — each documented
// as "the single source" (D-02). There is now ONE definition and one name.

/** Total outstanding receivable across all completed visits (matches the dashboard). */
export async function getOutstandingTotal(clinicId: string): Promise<number> {
  const net = appointmentNetSql();
  const [row] = await db
    .select({ v: sql<number>`coalesce(sum(greatest(${net} - ${appointments.amountCollected}, 0)), 0)::int` })
    .from(appointments)
    .leftJoin(users, eq(users.id, appointments.doctorId))
    .where(byClinic(appointments.clinicId, clinicId, notDeleted(appointments.deletedAt), eq(appointments.status, "completed")));
  return Number(row?.v ?? 0) + (await openingOwed(clinicId));
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
  /** Net imported opening balance owed (part of `outstanding`), 0 if none. */
  openingBalance: number;
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
  /** `patients` is this page; `total` and `patientCount` always describe the whole set. */
  paging: { offset: number; limit: number } = { offset: 0, limit: 500 },
): Promise<ReceivablesReport> {
  const net = appointmentNetSql();
  const conds = [eq(appointments.status, "completed"), sql`${net} > ${appointments.amountCollected}`];
  if (filters.doctorId) conds.push(eq(appointments.doctorId, filters.doctorId));
  if (filters.q) conds.push(or(ilike(patients.fullName, `%${filters.q}%`), ilike(patients.phone, `%${filters.q}%`))!);
  if (filters.from) conds.push(gte(appointments.scheduledAt, filters.from));
  if (filters.toExclusive) conds.push(lt(appointments.scheduledAt, filters.toExclusive));

  // GROUPED BY PATIENT IN SQL (delta D-12). This used to select every unpaid completed
  // appointment in the range and fold them into patients in JavaScript — an unbounded
  // scan whose result is a list of PATIENTS, so the rows were only ever a means to an
  // end. Grouping in SQL bounds it by patients-who-owe, which is a fraction of the
  // appointments and is bounded by the clinic's patient list rather than by its
  // history. The per-visit detail is then fetched only for the page (see below).
  //
  // `greatest(0, …)` mirrors the `Math.max(0, …)` the JS fold applied per visit, so an
  // overpaid visit still contributes nothing rather than a negative.
  const perVisitOutstanding = sql<number>`greatest(0, ${net} - ${appointments.amountCollected})`;
  const grouped = await db
    .select({
      patientId: patients.id,
      patientName: patients.fullName,
      patientPhone: patients.phone,
      billed: sql<number>`coalesce(sum(${net}), 0)::int`,
      collected: sql<number>`coalesce(sum(${appointments.amountCollected}), 0)::int`,
      outstanding: sql<number>`coalesce(sum(${perVisitOutstanding}), 0)::int`,
    })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .leftJoin(users, eq(users.id, appointments.doctorId))
    .where(byClinic(appointments.clinicId, clinicId, notDeleted(appointments.deletedAt), and(...conds)))
    .groupBy(patients.id, patients.fullName, patients.phone);

  const map = new Map<string, ReceivablePatient>();
  for (const r of grouped) {
    if (r.outstanding <= 0) continue;
    map.set(r.patientId, {
      patientId: r.patientId,
      name: r.patientName,
      phone: r.patientPhone,
      billed: Number(r.billed),
      collected: Number(r.collected),
      outstanding: Number(r.outstanding),
      openingBalance: 0,
      visits: [],
    });
  }


  // Merge in imported opening balances (net of any `opening` payments). These aren't
  // tied to a visit/doctor/date, so only when the view is unfiltered by doctor/date.
  if (!filters.doctorId && !filters.from && !filters.toExclusive) {
    const openConds = [sql`${patients.openingBalance} > 0`];
    if (filters.q) openConds.push(or(ilike(patients.fullName, `%${filters.q}%`), ilike(patients.phone, `%${filters.q}%`))!);
    const openRows = await db
      .select({ id: patients.id, name: patients.fullName, phone: patients.phone, opening: patients.openingBalance })
      .from(patients)
      .where(byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt), and(...openConds)));
    const payRows = await db
      .select({ pid: patientPayments.patientId, paid: sql<number>`coalesce(sum(${patientPayments.amount}), 0)::int` })
      .from(patientPayments)
      .where(byClinic(patientPayments.clinicId, clinicId, notDeleted(patientPayments.deletedAt), eq(patientPayments.kind, "opening")))
      .groupBy(patientPayments.patientId);
    const paidByPatient = new Map(payRows.map((r) => [r.pid, Number(r.paid)]));
    for (const o of openRows) {
      const net = Math.max(0, o.opening - (paidByPatient.get(o.id) ?? 0));
      if (net <= 0) continue;
      let p = map.get(o.id);
      if (!p) {
        p = { patientId: o.id, name: o.name, phone: o.phone, billed: 0, collected: 0, outstanding: 0, openingBalance: 0, visits: [] };
        map.set(o.id, p);
      }
      p.openingBalance = net;
      p.outstanding += net;
    }
  }

  const patientsList = [...map.values()].sort((a, b) => b.outstanding - a.outstanding);
  const total = patientsList.reduce((s, p) => s + p.outstanding, 0);
  const page = patientsList.slice(paging.offset, paging.offset + paging.limit);

  // The per-visit breakdown, for THIS PAGE's patients only. It is presentation detail
  // under each patient row, so fetching it for everyone was the expensive half of the
  // old query — and the totals above never needed it.
  if (page.length > 0) {
    const byId = new Map(page.map((p) => [p.patientId, p]));
    const visitRows = await db
      .select({
        appointmentId: appointments.id,
        scheduledAt: appointments.scheduledAt,
        bill: net,
        collected: appointments.amountCollected,
        patientId: appointments.patientId,
        doctorPrefix: users.prefix,
        doctorName: users.fullName,
        doctorUsername: users.username,
      })
      .from(appointments)
      .leftJoin(users, eq(users.id, appointments.doctorId))
      .where(
        byClinic(
          appointments.clinicId,
          clinicId,
          notDeleted(appointments.deletedAt),
          and(...conds, inArray(appointments.patientId, [...byId.keys()])),
        ),
      )
      .orderBy(desc(appointments.scheduledAt));

    for (const r of visitRows) {
      const p = byId.get(r.patientId);
      if (!p) continue;
      const bill = Number(r.bill);
      const outstanding = Math.max(0, bill - r.collected);
      if (outstanding <= 0) continue;
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
  }

  return { total, patientCount: patientsList.length, patients: page };
}
