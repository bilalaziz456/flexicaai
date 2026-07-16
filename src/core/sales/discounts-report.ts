import "server-only";

import { and, desc, eq, gt, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointmentDiscountApprovals, appointments, patients, users } from "@/core/db/schema";
import { appointmentProceduresNetSql } from "@/core/appointments/procedures";
import { computeFee, normalizeDiscountType } from "@/core/appointments/fee";
import { computeShare } from "@/core/appointments/shares";
import { getAppointmentShareContext } from "@/core/appointments/share-context";
import { displayStaffName } from "@/core/types/auth";
import type { ResolvedRange } from "@/core/sales/report";

export type DiscountRow = {
  appointmentId: string;
  scheduledAt: Date;
  patientName: string | null;
  doctorName: string | null;
  type: string; // amount | percent
  value: number; // the raw figure (e.g. 500, or 20 for 20%)
  amount: number; // the discount in Rs (applied / would-be)
  borneBy: string; // clinic | doctor | split
  status: string; // none | pending | approved | rejected
  clinicBears: number; // how much of `amount` the clinic absorbs
  doctorBears: number; // how much of `amount` the doctor(s) absorb (clinicBears+doctorBears = amount)
  approvedBy: string | null; // who signed the discount off (null when no approval was required)
};

export type DiscountsReport = {
  rows: DiscountRow[];
  count: number;
  totalApplied: number; // Σ amount where the discount actually applies (none/approved)
  totalPending: number; // Σ amount awaiting approval
};

/**
 * Discounts report (Finance) — every appointment that carries a discount in the
 * range, with the patient, doctor, borne-by, approval status and the discount in
 * Rs. Pure read over appointments (+ patient/doctor). The Rs amount is the discount
 * `computeFee` would apply to the visit's subtotal, so it matches the bill exactly.
 * Clinic-scoped.
 */
export async function getDiscountsReport(
  clinicId: string,
  range: ResolvedRange,
  filters: { doctorId?: string | null; borneBy?: string; status?: string } = {},
): Promise<DiscountsReport> {
  const conds = [
    gte(appointments.scheduledAt, range.start),
    lt(appointments.scheduledAt, range.end),
    gt(appointments.discountValue, 0),
  ];
  if (filters.doctorId) conds.push(eq(appointments.doctorId, filters.doctorId));
  if (filters.borneBy) conds.push(eq(appointments.discountBorneBy, filters.borneBy));
  if (filters.status) conds.push(eq(appointments.discountStatus, filters.status));

  const rows = await db
    .select({
      appointmentId: appointments.id,
      scheduledAt: appointments.scheduledAt,
      chargeConsultation: appointments.chargeConsultation,
      discountType: appointments.discountType,
      discountValue: appointments.discountValue,
      discountStatus: appointments.discountStatus,
      discountBorneBy: appointments.discountBorneBy,
      fee: users.consultationFee,
      doctorName: users.fullName,
      doctorUsername: users.username,
      doctorPrefix: users.prefix,
      patientName: patients.fullName,
      proceduresNet: appointmentProceduresNetSql(),
    })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .leftJoin(users, eq(users.id, appointments.doctorId))
    .where(byClinic(appointments.clinicId, clinicId, notDeleted(appointments.deletedAt), and(...conds)))
    .orderBy(desc(appointments.scheduledAt));

  const out: DiscountRow[] = rows.map((r) => {
    const type = normalizeDiscountType(r.discountType);
    const subtotal = (r.chargeConsultation ? (r.fee ?? 0) : 0) + Number(r.proceduresNet);
    const amount = computeFee(subtotal, type, r.discountValue).discount;
    return {
      appointmentId: r.appointmentId,
      scheduledAt: r.scheduledAt,
      patientName: r.patientName,
      doctorName:
        r.doctorName || r.doctorUsername
          ? displayStaffName(r.doctorPrefix, r.doctorName, r.doctorUsername ?? "")
          : null,
      type,
      value: r.discountValue,
      amount,
      borneBy: r.discountBorneBy,
      status: r.discountStatus,
      clinicBears: amount, // provisional; refined below
      doctorBears: 0,
      approvedBy: null as string | null,
    };
  });

  // Who signed each discount off — the approved approval rows (one query for all).
  const apptIds = out.map((r) => r.appointmentId);
  if (apptIds.length > 0) {
    const approvals = await db
      .select({
        appointmentId: appointmentDiscountApprovals.appointmentId,
        name: appointmentDiscountApprovals.decidedByName,
      })
      .from(appointmentDiscountApprovals)
      .where(
        byClinic(
          appointmentDiscountApprovals.clinicId,
          clinicId,
          and(
            inArray(appointmentDiscountApprovals.appointmentId, apptIds),
            eq(appointmentDiscountApprovals.status, "approved"),
          ),
        ),
      );
    const approverMap = new Map<string, string[]>();
    for (const a of approvals) {
      if (!a.name) continue;
      const arr = approverMap.get(a.appointmentId) ?? [];
      if (!arr.includes(a.name)) arr.push(a.name);
      approverMap.set(a.appointmentId, arr);
    }

    // Split each discount between clinic and doctor(s). Clinic-borne is a shortcut
    // (clinic absorbs all); doctor/split need the share context to weight by each
    // party's gross cut — mirroring computeShare's bucket order so the numbers match
    // the doctor payouts. Only the non-clinic rows pay the extra lookup.
    await Promise.all(
      out.map(async (row) => {
        row.approvedBy = approverMap.get(row.appointmentId)?.join(", ") ?? null;
        if (row.amount <= 0 || row.borneBy === "clinic") {
          row.clinicBears = row.amount;
          row.doctorBears = 0;
          return;
        }
        const ctx = await getAppointmentShareContext(clinicId, row.appointmentId);
        if (!ctx.found || ctx.grossTotal <= 0) {
          row.clinicBears = row.amount;
          row.doctorBears = 0;
          return;
        }
        const gross = computeShare({
          consultation: ctx.consultation,
          lines: ctx.lines,
          netTotal: ctx.grossTotal, // no discount → each party's full gross cut
          borneBy: "clinic",
        });
        const doctorGross = Object.values(gross.doctors).reduce((s, v) => s + v, 0);
        const doctorBears =
          row.borneBy === "doctor"
            ? Math.min(row.amount, doctorGross) // doctors first, spill to clinic
            : Math.round((row.amount * doctorGross) / (gross.clinic + doctorGross || 1)); // split: proportional
        row.doctorBears = doctorBears;
        row.clinicBears = row.amount - doctorBears;
      }),
    );
  }

  const applied = (s: string) => s === "none" || s === "approved";
  return {
    rows: out,
    count: out.length,
    totalApplied: out.filter((r) => applied(r.status)).reduce((s, r) => s + r.amount, 0),
    totalPending: out.filter((r) => r.status === "pending").reduce((s, r) => s + r.amount, 0),
  };
}
