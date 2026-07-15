import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, patientPayments, users } from "@/core/db/schema";
import { appointmentProceduresNetSql } from "@/core/appointments/procedures";
import {
  computeAppointmentTotal,
  effectiveDiscountValue,
  normalizeDiscountType,
} from "@/core/appointments/fee";
import { getPatientCredit } from "@/core/billing/payments";

/**
 * A patient's account (Finance) — the per-visit bill/collected/outstanding across
 * their completed visits, the totals, unallocated advance credit, and recent ledger
 * entries. CORE, clinic-scoped. Bills are computed the same way as the appointment
 * detail (approval-gated discount), so figures reconcile everywhere.
 */
export type PatientVisit = {
  id: string;
  scheduledAt: Date;
  bill: number;
  collected: number;
  outstanding: number;
};

export type PatientLedgerEntry = {
  id: string;
  kind: string;
  amount: number;
  method: string | null;
  occurredAt: Date;
};

export type PatientAccount = {
  credit: number;
  totals: { billed: number; collected: number; outstanding: number };
  visits: PatientVisit[];
  payments: PatientLedgerEntry[];
};

export async function getPatientAccount(
  clinicId: string,
  patientId: string,
): Promise<PatientAccount> {
  const rows = await db
    .select({
      id: appointments.id,
      scheduledAt: appointments.scheduledAt,
      chargeConsultation: appointments.chargeConsultation,
      discountType: appointments.discountType,
      discountValue: appointments.discountValue,
      discountStatus: appointments.discountStatus,
      amountCollected: appointments.amountCollected,
      fee: users.consultationFee,
      proceduresNet: appointmentProceduresNetSql(),
    })
    .from(appointments)
    .leftJoin(users, eq(users.id, appointments.doctorId))
    .where(
      byClinic(
        appointments.clinicId,
        clinicId,
        notDeleted(appointments.deletedAt),
        and(eq(appointments.patientId, patientId), eq(appointments.status, "completed")),
      ),
    )
    .orderBy(desc(appointments.scheduledAt));

  const visits: PatientVisit[] = rows.map((r) => {
    const bill = computeAppointmentTotal(
      r.chargeConsultation ? (r.fee ?? 0) : 0,
      Number(r.proceduresNet),
      normalizeDiscountType(r.discountType),
      effectiveDiscountValue(r.discountStatus, r.discountValue),
    ).net;
    const collected = r.amountCollected;
    return { id: r.id, scheduledAt: r.scheduledAt, bill, collected, outstanding: Math.max(0, bill - collected) };
  });

  const totals = visits.reduce(
    (a, v) => ({
      billed: a.billed + v.bill,
      collected: a.collected + v.collected,
      outstanding: a.outstanding + v.outstanding,
    }),
    { billed: 0, collected: 0, outstanding: 0 },
  );

  const [credit, payments] = await Promise.all([
    getPatientCredit(clinicId, patientId),
    db
      .select({
        id: patientPayments.id,
        kind: patientPayments.kind,
        amount: patientPayments.amount,
        method: patientPayments.method,
        occurredAt: patientPayments.occurredAt,
      })
      .from(patientPayments)
      .where(
        byClinic(
          patientPayments.clinicId,
          clinicId,
          notDeleted(patientPayments.deletedAt),
          eq(patientPayments.patientId, patientId),
        ),
      )
      .orderBy(desc(patientPayments.occurredAt))
      .limit(50),
  ]);

  return { credit, totals, visits, payments };
}
