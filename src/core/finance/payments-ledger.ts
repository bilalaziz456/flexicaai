import "server-only";

import { and, desc, eq, gte, ilike, lt, or, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, patientPayments, patients, users } from "@/core/db/schema";
import { displayStaffName } from "@/core/types/auth";

/**
 * Payments ledger (Finance) — CORE read of the money-in/out subledger across the
 * whole clinic, for the standalone `/clinic/payments` report + its CSV. One row per
 * live `patient_payments` entry, joined to the patient and (via the appointment) the
 * doctor, filterable by date/patient/method/kind/doctor. Clinic-scoped; the per-visit
 * void/refund UI stays on the appointment detail — this is a read-only register.
 */

export type PaymentLedgerRow = {
  id: string;
  kind: string;
  amount: number; // positive; refund is money out
  method: string | null;
  reference: string | null;
  note: string | null;
  occurredAt: Date;
  createdByName: string | null;
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  appointmentId: string | null;
  doctorName: string | null;
};

export type PaymentLedgerFilters = {
  from?: Date;
  toExclusive?: Date;
  q?: string; // patient name / phone search
  method?: string;
  kind?: string;
  doctorId?: string;
  limit?: number;
  offset?: number;
};

export type PaymentLedger = {
  rows: PaymentLedgerRow[];
  total: number; // matching row count (for pagination)
  totals: { in: number; out: number; net: number };
};

/** `refund` is money OUT; everything else is money in. Kept in sync with daybook. */
const OUT_KINDS = new Set(["refund"]);

function conds(clinicId: string, f: PaymentLedgerFilters) {
  const parts = [notDeleted(patientPayments.deletedAt)];
  if (f.from) parts.push(gte(patientPayments.occurredAt, f.from));
  if (f.toExclusive) parts.push(lt(patientPayments.occurredAt, f.toExclusive));
  if (f.method) parts.push(eq(patientPayments.method, f.method));
  if (f.kind) parts.push(eq(patientPayments.kind, f.kind));
  if (f.doctorId) parts.push(eq(appointments.doctorId, f.doctorId));
  if (f.q) {
    const like = `%${f.q}%`;
    parts.push(or(ilike(patients.fullName, like), ilike(patients.phone, like))!);
  }
  return byClinic(patientPayments.clinicId, clinicId, and(...parts));
}

export async function getPaymentsLedger(
  clinicId: string,
  filters: PaymentLedgerFilters = {},
): Promise<PaymentLedger> {
  const where = conds(clinicId, filters);

  const [rows, [{ total }], [sums]] = await Promise.all([
    db
      .select({
        id: patientPayments.id,
        kind: patientPayments.kind,
        amount: patientPayments.amount,
        method: patientPayments.method,
        reference: patientPayments.reference,
        note: patientPayments.note,
        occurredAt: patientPayments.occurredAt,
        createdByName: patientPayments.createdByName,
        patientId: patients.id,
        patientName: patients.fullName,
        patientPhone: patients.phone,
        appointmentId: patientPayments.appointmentId,
        doctorPrefix: users.prefix,
        doctorFullName: users.fullName,
        doctorUsername: users.username,
      })
      .from(patientPayments)
      .innerJoin(patients, eq(patients.id, patientPayments.patientId))
      .leftJoin(appointments, eq(appointments.id, patientPayments.appointmentId))
      .leftJoin(users, eq(users.id, appointments.doctorId))
      .where(where)
      .orderBy(desc(patientPayments.occurredAt))
      .limit(filters.limit ?? 100)
      .offset(filters.offset ?? 0),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(patientPayments)
      .innerJoin(patients, eq(patients.id, patientPayments.patientId))
      .leftJoin(appointments, eq(appointments.id, patientPayments.appointmentId))
      .where(where),
    // Money in = payment + advance + advance_applied; out = refund. Net = in − out.
    db
      .select({
        moneyIn: sql<number>`coalesce(sum(case when ${patientPayments.kind} = 'refund' then 0 else ${patientPayments.amount} end), 0)::int`,
        moneyOut: sql<number>`coalesce(sum(case when ${patientPayments.kind} = 'refund' then ${patientPayments.amount} else 0 end), 0)::int`,
      })
      .from(patientPayments)
      .innerJoin(patients, eq(patients.id, patientPayments.patientId))
      .leftJoin(appointments, eq(appointments.id, patientPayments.appointmentId))
      .where(where),
  ]);

  const moneyIn = Number(sums?.moneyIn ?? 0);
  const moneyOut = Number(sums?.moneyOut ?? 0);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      amount: r.amount,
      method: r.method,
      reference: r.reference,
      note: r.note,
      occurredAt: r.occurredAt,
      createdByName: r.createdByName,
      patientId: r.patientId,
      patientName: r.patientName,
      patientPhone: r.patientPhone,
      appointmentId: r.appointmentId,
      doctorName:
        r.doctorFullName || r.doctorUsername
          ? displayStaffName(r.doctorPrefix, r.doctorFullName, r.doctorUsername ?? "")
          : null,
    })),
    total: Number(total),
    totals: { in: moneyIn, out: moneyOut, net: moneyIn - moneyOut },
  };
}

/** Is this ledger kind money-out (a refund)? Exposed so the UI signs the amount. */
export function isMoneyOut(kind: string): boolean {
  return OUT_KINDS.has(kind);
}
