import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "@/core/db";
import type { Executor } from "@/core/db/tx";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointmentProcedures, appointments, users } from "@/core/db/schema";
import {
  computeBill,
  computeProcedureLine,
  effectiveDiscountValue,
  normalizeDiscountType,
  type DiscountType,
} from "@/core/appointments/fee";
import {
  computeShare,
  resolveProcedureRate,
  type ShareBorneBy,
  type ShareInput,
} from "@/core/appointments/shares";
import { getDoctorShareRatesMany } from "@/core/appointments/share-config";

/**
 * Assembles everything the revenue SPLIT and the discount-APPROVAL workflow need
 * for one appointment: the consulting doctor's share of the (charged) consultation
 * fee, each procedure line's performing doctor + gross + resolved rate, the gross
 * total, and the net the patient pays — both as REQUESTED (raw discount) and as
 * EFFECTIVE (gated by the discount's approval status). All clinic-scoped.
 */
export type AppointmentShareContext = {
  found: boolean;
  /** The appointment's scheduled time — the ledger's `occurred_at`. */
  occurredAt: Date | null;
  borneBy: ShareBorneBy;
  discountType: DiscountType;
  discountValue: number;
  discountStatus: string;
  /** For borneBy='split': the doctor side's portion of the discount. */
  discountSplitType: string;
  discountSplitValue: number;
  consultation: { doctorId: string; fee: number; pct: number } | null;
  /** Procedure lines. `lineRef` (the appointment_procedures row id) + `label` (name
   *  snapshot) identify a line for a per-line waive. */
  /** `gross` is the line's SHARE BASE: its price after its clinic offer (see below). */
  lines: { doctorId: string | null; gross: number; pct: number; lineRef: string; label: string }[];
  /** Consultation + every line's share base — the bill AFTER clinic offers and BEFORE
   *  the patient discount. So `grossTotal − netEffective` is the patient discount. */
  grossTotal: number;
  /** Net with the discount the staff entered (ignores approval status). */
  netRequested: number;
  /** The PATIENT discount alone, in PKR as entered (ignores approval status): the
   *  appointment-level discount on the subtotal. Excludes line discounts, which are
   *  clinic offers and never need approval. */
  patientDiscount: number;
  /** Net gated by approval status (pending/rejected → discount treated as 0). */
  netEffective: number;
  /** Doctors who earn a positive share here (before any discount). */
  earnerDoctorIds: string[];
};

function toBorneBy(v: string | null | undefined): ShareBorneBy {
  return v === "doctor" || v === "split" ? v : "clinic";
}

export async function getAppointmentShareContext(
  clinicId: string,
  appointmentId: string,
  // Reads through the caller's transaction when there is one, so a ledger snapshot
  // taken during a status change sees the NEW status, not the committed old row.
  exec: Executor = db,
): Promise<AppointmentShareContext> {
  const empty: AppointmentShareContext = {
    found: false,
    occurredAt: null,
    borneBy: "clinic",
    discountType: "amount",
    discountValue: 0,
    discountStatus: "none",
    discountSplitType: "percent",
    discountSplitValue: 0,
    consultation: null,
    lines: [],
    grossTotal: 0,
    netRequested: 0,
    patientDiscount: 0,
    netEffective: 0,
    earnerDoctorIds: [],
  };

  const [appt] = await exec
    .select({
      doctorId: appointments.doctorId,
      scheduledAt: appointments.scheduledAt,
      chargeConsultation: appointments.chargeConsultation,
      discountType: appointments.discountType,
      discountValue: appointments.discountValue,
      discountBorneBy: appointments.discountBorneBy,
      discountStatus: appointments.discountStatus,
      discountSplitType: appointments.discountSplitType,
      discountSplitValue: appointments.discountSplitValue,
    })
    .from(appointments)
    .where(
      byClinic(
        appointments.clinicId,
        clinicId,
        notDeleted(appointments.deletedAt),
        eq(appointments.id, appointmentId),
      ),
    )
    .limit(1);
  if (!appt) return empty;

  // The consulting doctor supplies the consultation fee + their consultation share.
  let consultFee = 0;
  let consultDoctorId: string | null = null;
  if (appt.chargeConsultation && appt.doctorId) {
    const [doc] = await exec
      .select({ id: users.id, fee: users.consultationFee })
      .from(users)
      .where(byClinic(users.clinicId, clinicId, eq(users.id, appt.doctorId)))
      .limit(1);
    if (doc && doc.fee > 0) {
      consultFee = doc.fee;
      consultDoctorId = doc.id;
    }
  }

  // Procedure lines with their performing doctor + own discount (for the net).
  const procRows = await exec
    .select({
      id: appointmentProcedures.id,
      name: appointmentProcedures.name,
      procedureId: appointmentProcedures.procedureId,
      unitPrice: appointmentProcedures.unitPrice,
      quantity: appointmentProcedures.quantity,
      discountType: appointmentProcedures.discountType,
      discountValue: appointmentProcedures.discountValue,
      doctorId: appointmentProcedures.doctorId,
    })
    .from(appointmentProcedures)
    .where(
      byClinic(
        appointmentProcedures.clinicId,
        clinicId,
        eq(appointmentProcedures.appointmentId, appointmentId),
      ),
    )
    .orderBy(asc(appointmentProcedures.name));

  // Rates for every doctor involved (consulting + each performing doctor).
  const doctorIds = [
    ...new Set(
      [consultDoctorId, ...procRows.map((r) => r.doctorId)].filter(
        (v): v is string => Boolean(v),
      ),
    ),
  ];
  const rates = await getDoctorShareRatesMany(clinicId, doctorIds);

  const consultation =
    consultDoctorId && consultFee > 0
      ? {
          doctorId: consultDoctorId,
          fee: consultFee,
          pct: rates.get(consultDoctorId)?.consultationPct ?? 0,
        }
      : null;

  // A line's SHARE BASE is its price AFTER its own discount — the clinic offer it was
  // booked with (owner's call, 2026-10-11): an offer is shared in proportion, as if
  // the clinic had simply lowered the price, so a 10% share of a Rs 1,000 procedure
  // under a 10% offer is Rs 90. Only the PATIENT discount (on the appointment) is
  // then left for "Discount borne by" to place — before this, that setting decided
  // who paid for the clinic's offer too, so the same visit could earn the doctor
  // Rs 100, Rs 90 or nothing depending on a field about something else. Every share
  // figure is derived from these lines (sale shares, settlements, per-line waives),
  // so this one change moves them all together.
  const lines = procRows.map((r) => {
    const rate = r.doctorId ? rates.get(r.doctorId) : undefined;
    const line = computeProcedureLine({
      unitPrice: r.unitPrice,
      quantity: r.quantity,
      discountType: normalizeDiscountType(r.discountType),
      discountValue: r.discountValue,
    });
    return {
      doctorId: r.doctorId,
      gross: Math.max(0, line.net),
      pct: rate ? resolveProcedureRate(rate, r.procedureId) : 0,
      lineRef: r.id,
      label: r.name,
    };
  });

  // The patient's net (both requested and approval-gated).
  const discountType = normalizeDiscountType(appt.discountType);
  const lineInputs = procRows.map((r) => ({
    unitPrice: r.unitPrice,
    quantity: r.quantity,
    discountType: normalizeDiscountType(r.discountType),
    discountValue: r.discountValue,
  }));
  const requested = computeBill(consultFee, lineInputs, discountType, appt.discountValue);
  const netRequested = requested.net;
  const netEffective = computeBill(
    consultFee,
    lineInputs,
    discountType,
    effectiveDiscountValue(appt.discountStatus, appt.discountValue),
  ).net;

  const grossTotal =
    consultFee + lines.reduce((s, l) => s + l.gross, 0);

  // Earners = doctors whose GROSS share (no discount) is positive.
  const grossSplit = computeShare({
    consultation,
    lines,
    netTotal: grossTotal, // no discount → each keeps full gross share
    borneBy: "clinic",
  });
  const earnerDoctorIds = Object.entries(grossSplit.doctors)
    .filter(([, amt]) => amt > 0)
    .map(([id]) => id);

  return {
    found: true,
    occurredAt: appt.scheduledAt,
    borneBy: toBorneBy(appt.discountBorneBy),
    discountType,
    discountValue: appt.discountValue,
    discountStatus: appt.discountStatus,
    discountSplitType: appt.discountSplitType,
    discountSplitValue: appt.discountSplitValue,
    consultation,
    lines,
    grossTotal,
    netRequested,
    patientDiscount: requested.appointmentDiscount,
    netEffective,
    earnerDoctorIds,
  };
}

/** Build the `computeShare` input from a context, using the approval-gated net. */
export function shareInputFromContext(ctx: AppointmentShareContext): ShareInput {
  return {
    consultation: ctx.consultation,
    lines: ctx.lines,
    netTotal: ctx.netEffective,
    borneBy: ctx.borneBy,
  };
}
