import "server-only";

import { and, desc, eq, gt, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointmentDiscountApprovals, appointments, patients, users } from "@/core/db/schema";
import { appointmentProceduresNetSql } from "@/core/appointments/procedures";
import { appointmentDiscountSql } from "@/core/appointments/bill-sql";
import { computeFee, normalizeDiscountType } from "@/core/appointments/fee";
import { discountBorneSplit } from "@/core/appointments/discount-bearing";
import type { BearBorneBy } from "@/core/appointments/discount-bearing";
import { displayStaffName } from "@/core/types/auth";
import type { ResolvedRange } from "@/core/sales/report";
import { discountStatusId } from "@/core/db/vocabulary-seed";
import {
  asCode,
  DISCOUNT_BEARER_ROWS,
  DISCOUNT_STATUS_ROWS,
  type DiscountBearerCode,
  type DiscountStatusCode,
} from "@/core/db/vocabulary-seed";

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
  rows: DiscountRow[]; // ONE PAGE — `count` is the full match
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
  paging: { offset: number; limit: number } = { offset: 0, limit: 200 },
): Promise<DiscountsReport> {
  const conds = [
    gte(appointments.scheduledAt, range.start),
    lt(appointments.scheduledAt, range.end),
    gt(appointments.discountValue, 0),
  ];
  if (filters.doctorId) conds.push(eq(appointments.doctorId, filters.doctorId));
  const borneBy = asCode<DiscountBearerCode>(DISCOUNT_BEARER_ROWS, filters.borneBy);
  if (borneBy) conds.push(eq(appointments.discountBorneBy, borneBy));
  const status = asCode<DiscountStatusCode>(DISCOUNT_STATUS_ROWS, filters.status);
  if (status) conds.push(eq(appointments.discountStatus, status));

  const rows = await db
    .select({
      appointmentId: appointments.id,
      scheduledAt: appointments.scheduledAt,
      chargeConsultation: appointments.chargeConsultation,
      discountType: appointments.discountType,
      discountValue: appointments.discountValue,
      discountStatus: appointments.discountStatus,
      discountBorneBy: appointments.discountBorneBy,
      discountSplitType: appointments.discountSplitType,
      discountSplitValue: appointments.discountSplitValue,
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
    .orderBy(desc(appointments.scheduledAt))
    // ONE PAGE (delta D-12). This used to select every discounted appointment in the
    // range — a year of them — map each in JS, then `reduce` for two totals. The
    // totals now come from SQL below, so the page no longer has to BE the whole set.
    .limit(paging.limit)
    .offset(paging.offset);

  const out: DiscountRow[] = rows.map((r) => {
    const type = normalizeDiscountType(r.discountType);
    const subtotal = (r.chargeConsultation ? (r.fee ?? 0) : 0) + Number(r.proceduresNet);
    const amount = computeFee(subtotal, type, r.discountValue).discount;
    // No spillover (the new rule): the split follows borne-by + split only.
    const { clinicBorne, doctorBorne } = discountBorneSplit(amount, r.discountBorneBy as BearBorneBy, {
      type: r.discountSplitType === "amount" ? "amount" : "percent",
      value: r.discountSplitValue,
    });
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
      clinicBears: clinicBorne,
      doctorBears: doctorBorne,
      approvedBy: null as string | null,
    };
  });

  // Who signed each discount off — the approved approval rows (one query for all).
  const apptIds = out.map((r) => r.appointmentId);
  if (apptIds.length > 0) {
    const approvals = await db
      .select({
        appointmentId: appointmentDiscountApprovals.appointmentId,
        kind: appointmentDiscountApprovals.approverKind,
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
    // Label each sign-off by its side so a SPLIT discount that needed both a clinic
    // and a doctor approval reads clearly, e.g. "Clinic: Sara · Dr: Bilal". Clinic
    // rows come first. (De-dup identical side+name.)
    const approverMap = new Map<string, string[]>();
    for (const a of approvals) {
      if (!a.name) continue;
      const label = `${a.kind === "doctor" ? "Dr" : "Clinic"}: ${a.name}`;
      const arr = approverMap.get(a.appointmentId) ?? [];
      if (!arr.includes(label)) arr.push(label);
      approverMap.set(a.appointmentId, arr);
    }
    for (const [, arr] of approverMap) {
      arr.sort((x, y) => (x.startsWith("Clinic") ? 0 : 1) - (y.startsWith("Clinic") ? 0 : 1));
    }
    for (const row of out) row.approvedBy = approverMap.get(row.appointmentId)?.join(" · ") ?? null;
  }

  // Totals over the WHOLE match, in SQL — not over `out`, which is now one page.
  //
  // The rupee amount is `appointmentDiscountSql({ raw: true })`, the very expression
  // the bill is built from (ADR-015), asked for the un-gated value because this report
  // shows a pending discount at what it WOULD take off. So the SQL total and the
  // per-row `computeFee` figure are two renderings of one formula, not two formulas —
  // `scripts/test-bill-parity.ts` is what keeps them honest.
  const amountSql = appointmentDiscountSql({ raw: true });
  const [totals] = await db
    .select({
      count: sql<number>`count(*)::int`,
      applied: sql<number>`coalesce(sum(${amountSql}) filter (where ${appointments.discountStatus} in (${discountStatusId("none")}, ${discountStatusId("approved")})), 0)::int`,
      pending: sql<number>`coalesce(sum(${amountSql}) filter (where ${appointments.discountStatus} = ${discountStatusId("pending")}), 0)::int`,
    })
    .from(appointments)
    .leftJoin(users, eq(users.id, appointments.doctorId))
    .where(byClinic(appointments.clinicId, clinicId, notDeleted(appointments.deletedAt), and(...conds)));

  return {
    rows: out,
    count: totals?.count ?? 0,
    totalApplied: totals?.applied ?? 0,
    totalPending: totals?.pending ?? 0,
  };
}
