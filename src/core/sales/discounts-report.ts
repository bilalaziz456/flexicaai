import "server-only";

import { and, desc, eq, gt, gte, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointmentDiscountApprovals, appointments, patients, users } from "@/core/db/schema";
import {
  appointmentHasLineDiscountSql,
  appointmentLinesPatientDiscountSql,
  procedureTotals,
} from "@/core/appointments/procedures";
import { appointmentDiscountSql, consultationDiscountRawSql } from "@/core/appointments/bill-sql";
import { discountBorneSplit } from "@/core/appointments/discount-bearing";
import { getAppointmentShareContext } from "@/core/appointments/share-context";
import { pieceApprovalStatus } from "@/core/appointments/approvals";
import { listClinicDoctors } from "@/core/appointments/doctors";
import { displayStaffName } from "@/core/types/auth";
import type { ResolvedRange } from "@/core/sales/report";
import { approvalStatusId, discountBearerId, discountStatusId } from "@/core/db/vocabulary-seed";
import {
  asCode,
  DISCOUNT_BEARER_ROWS,
  DISCOUNT_STATUS_ROWS,
  type DiscountBearerCode,
  type DiscountStatusCode,
} from "@/core/db/vocabulary-seed";

export type DiscountRow = {
  /** One row per DISCOUNT, not per visit (docs/per-line-discount-plan.md §8): a line's,
   *  the consultation's, or the whole visit's. `key` tells them apart within a visit. */
  key: string;
  appointmentId: string;
  scheduledAt: Date;
  patientName: string | null;
  /** The doctor it concerns: a line's performing doctor, else the visit's doctor. */
  doctorName: string | null;
  /** What it is for: "Root canal", "Consultation", "Whole visit". */
  label: string;
  type: string; // amount | percent
  value: number; // the raw figure (e.g. 500, or 20 for 20%)
  amount: number; // the discount in Rs (applied / would-be)
  borneBy: string; // clinic | doctor | split
  status: string; // none | pending | approved | rejected — THIS discount's own
  clinicBears: number; // how much of `amount` the clinic absorbs
  doctorBears: number; // how much of `amount` the doctor(s) absorb (clinicBears+doctorBears = amount)
  approvedBy: string | null; // who signed the visit's discounts off (null when nobody was asked)
};

export type DiscountsReport = {
  rows: DiscountRow[]; // the discounts of ONE PAGE of visits — `count` is the full match
  count: number; // visits carrying a discount
  totalApplied: number; // Σ amount where the discount actually applies (none/approved)
  totalPending: number; // Σ amount awaiting approval
};

/**
 * Discounts report (Finance) — every PATIENT discount given on a visit in the range:
 * each line's, the consultation's and the whole visit's, with who bears it and its own
 * approval state (docs/per-line-discount-plan.md §6, §8). Clinic offers are not here —
 * they are the price list's, not a discount someone gave. Clinic-scoped.
 *
 * Paged by VISIT, so a page never splits one visit's discounts; each visit's are read
 * through `getAppointmentShareContext` — the same figures the bill and the split use.
 */
export async function getDiscountsReport(
  clinicId: string,
  range: ResolvedRange,
  filters: { doctorId?: string | null; borneBy?: string; status?: string } = {},
  paging: { offset: number; limit: number } = { offset: 0, limit: 200 },
): Promise<DiscountsReport> {
  const hasConsultDiscount = and(eq(appointments.chargeConsultation, true), gt(appointments.consultationDiscountValue, 0));
  const conds: (SQL | undefined)[] = [
    gte(appointments.scheduledAt, range.start),
    lt(appointments.scheduledAt, range.end),
    or(gt(appointments.discountValue, 0), hasConsultDiscount, appointmentHasLineDiscountSql()),
  ];
  if (filters.doctorId) {
    conds.push(or(eq(appointments.doctorId, filters.doctorId), appointmentHasLineDiscountSql({ doctorId: filters.doctorId })));
  }
  const borneBy = asCode<DiscountBearerCode>(DISCOUNT_BEARER_ROWS, filters.borneBy);
  if (borneBy) {
    conds.push(
      or(
        and(gt(appointments.discountValue, 0), eq(appointments.discountBorneBy, borneBy)),
        and(hasConsultDiscount, eq(appointments.consultationBorneBy, borneBy)),
        appointmentHasLineDiscountSql({ bearerId: discountBearerId(borneBy) }),
      ),
    );
  }
  // A visit matches when its whole-visit discount is in that state (`discount_status`
  // is that discount's own gate), or its approval rows add up to it — the rule the
  // approvals queue shows (any rejected → rejected; any pending → pending).
  const status = asCode<DiscountStatusCode>(DISCOUNT_STATUS_ROWS, filters.status);
  if (status) {
    conds.push(
      or(and(gt(appointments.discountValue, 0), eq(appointments.discountStatus, status)), visitApprovalStatusSql(status)),
    );
  }

  const page = await db
    .select({
      appointmentId: appointments.id,
      scheduledAt: appointments.scheduledAt,
      discountStatus: appointments.discountStatus,
      doctorName: users.fullName,
      doctorUsername: users.username,
      doctorPrefix: users.prefix,
      patientName: patients.fullName,
    })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .leftJoin(users, eq(users.id, appointments.doctorId))
    .where(byClinic(appointments.clinicId, clinicId, notDeleted(appointments.deletedAt), and(...conds)))
    .orderBy(desc(appointments.scheduledAt))
    // ONE PAGE (delta D-12): totals come from SQL below, so the page need not be the set.
    .limit(paging.limit)
    .offset(paging.offset);

  const apptIds = page.map((r) => r.appointmentId);
  const approvals =
    apptIds.length > 0
      ? await db
          .select({
            appointmentId: appointmentDiscountApprovals.appointmentId,
            kind: appointmentDiscountApprovals.approverKind,
            doctorId: appointmentDiscountApprovals.approverDoctorId,
            status: appointmentDiscountApprovals.status,
            name: appointmentDiscountApprovals.decidedByName,
          })
          .from(appointmentDiscountApprovals)
          .where(byClinic(appointmentDiscountApprovals.clinicId, clinicId, inArray(appointmentDiscountApprovals.appointmentId, apptIds)))
      : [];

  // Names for line doctors that are not the visit's doctor.
  const doctorNames = new Map<string, string>();
  const staff = await listClinicDoctors(clinicId);
  for (const d of staff) doctorNames.set(d.id, d.name);

  const out: DiscountRow[] = [];
  for (const v of page) {
    const ctx = await getAppointmentShareContext(clinicId, v.appointmentId);
    const rows = approvals.filter((a) => a.appointmentId === v.appointmentId);
    // Label each sign-off by its side so a SPLIT discount that needed both a clinic
    // and a doctor approval reads clearly, e.g. "Clinic: Sara · Dr: Bilal".
    const signed = [...new Set(
      rows
        .filter((a) => a.status === "approved" && a.name)
        .sort((x, y) => (x.kind === "clinic" ? 0 : 1) - (y.kind === "clinic" ? 0 : 1))
        .map((a) => `${a.kind === "doctor" ? "Dr" : "Clinic"}: ${a.name}`),
    )];
    const visitDoctor =
      v.doctorName || v.doctorUsername ? displayStaffName(v.doctorPrefix, v.doctorName, v.doctorUsername ?? "") : null;
    for (const piece of ctx.requestedPieces) {
      if (borneBy && piece.borneBy !== borneBy) continue;
      // The whole-visit discount's gate is its own column (older visits have no rows).
      const pieceStatus =
        piece.key === "overall" ? v.discountStatus : pieceApprovalStatus(piece, ctx.earnerDoctorIds, rows);
      if (status && pieceStatus !== status) continue;
      const { clinicBorne, doctorBorne } = discountBorneSplit(piece.amount, piece.borneBy, piece.split);
      out.push({
        key: `${v.appointmentId}:${piece.key}`,
        appointmentId: v.appointmentId,
        scheduledAt: v.scheduledAt,
        patientName: v.patientName,
        doctorName: piece.doctorId ? (doctorNames.get(piece.doctorId) ?? visitDoctor) : visitDoctor,
        label: piece.label,
        type: piece.type,
        value: piece.value,
        amount: piece.amount,
        borneBy: piece.borneBy,
        status: pieceStatus,
        clinicBears: clinicBorne,
        doctorBears: doctorBorne,
        approvedBy: signed.length > 0 ? signed.join(" · ") : null,
      });
    }
  }

  // Totals over the WHOLE match, in SQL — not over `out`, which is one page. Each
  // rupee figure is the expression the bill is built from (ADR-015), asked for the
  // un-gated value, because a waiting discount is shown at what it WOULD take off.
  // `scripts/test-bill-parity.ts` keeps those expressions equal to the TS bill.
  const pt = procedureTotals(clinicId);
  const overallSql = appointmentDiscountSql({ raw: true, totals: pt });
  const consultSql = sql<number>`(case when ${appointments.chargeConsultation} then ${consultationDiscountRawSql()} else 0 end)`;
  const rejected = sql`exists (select 1 from ${appointmentDiscountApprovals} where ${appointmentDiscountApprovals.appointmentId} = ${appointments.id} and ${appointmentDiscountApprovals.status} = ${approvalStatusId("rejected")})`;
  const [totals] = await db
    .select({
      count: sql<number>`count(*)::int`,
      applied: sql<number>`(
        coalesce(sum(${overallSql}) filter (where ${appointments.discountStatus} in (${discountStatusId("none")}, ${discountStatusId("approved")})), 0)
        + coalesce(sum(${consultSql}) filter (where not ${appointments.consultationDiscountHeld}), 0)
        + coalesce(sum(${appointmentLinesPatientDiscountSql(false)}), 0)
      )::int`,
      pending: sql<number>`(
        coalesce(sum(${overallSql}) filter (where ${appointments.discountStatus} = ${discountStatusId("pending")}), 0)
        + coalesce(sum(${consultSql}) filter (where ${appointments.consultationDiscountHeld} and not ${rejected}), 0)
        + coalesce(sum(${appointmentLinesPatientDiscountSql(true)}) filter (where not ${rejected}), 0)
      )::int`,
    })
    .from(appointments)
    .leftJoin(users, eq(users.id, appointments.doctorId))
    .leftJoin(pt, eq(pt.appointmentId, appointments.id))
    .where(byClinic(appointments.clinicId, clinicId, notDeleted(appointments.deletedAt), and(...conds)));

  return {
    rows: out,
    count: totals?.count ?? 0,
    totalApplied: totals?.applied ?? 0,
    totalPending: totals?.pending ?? 0,
  };
}

/** A visit's approval summary as a condition over its approval rows. */
function visitApprovalStatusSql(status: DiscountStatusCode): SQL {
  const t = appointmentDiscountApprovals;
  const any = (st?: "pending" | "rejected" | "approved") =>
    sql`exists (select 1 from ${t} where ${t.appointmentId} = ${appointments.id}${st ? sql` and ${t.status} = ${approvalStatusId(st)}` : sql``})`;
  switch (status) {
    case "none":
      return sql`not ${any()}`;
    case "rejected":
      return any("rejected");
    case "pending":
      return sql`(${any("pending")} and not ${any("rejected")})`;
    default:
      return sql`(${any()} and not ${any("pending")} and not ${any("rejected")})`;
  }
}
