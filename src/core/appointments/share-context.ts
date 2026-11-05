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
import {
  buildDiscountPieces,
  type BearBorneBy,
  type BearSplit,
  type BearingPiece,
  type OfferBorneBy,
} from "@/core/appointments/discount-bearing";

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
  /** Which rule bears this visit's discount (`appointments.bearing_version`):
   *  1 = one bearer for the whole discount (`borneBy`, spread over the doctors);
   *  2 = per line — `pieces` (docs/per-line-discount-plan.md §3). */
  bearingVersion: 1 | 2;
  /** Version 2 only (else []): each EFFECTIVE discount with its own bearer and, for
   *  a doctor-borne part, whose share it comes from. A held discount is absent.
   *  Σ amount = grossTotal − netEffective. */
  pieces: BearingPiece[];
  /** Every PATIENT discount as entered (approval ignored) — what approval is about
   *  (docs/per-line-discount-plan.md §6). Clinic offers are never here. On a version-1
   *  visit this is just the overall discount. */
  requestedPieces: RequestedPiece[];
};

/** One patient discount awaiting (or past) approval. */
export type RequestedPiece = {
  /** "overall" | "consultation" | an appointment_procedures id. */
  key: string;
  /** What the approver is told it is for: "Root canal", "Consultation", "Whole visit". */
  label: string;
  /** As entered: "amount" | "percent" and the raw figure (500, or 10 for 10%). */
  type: DiscountType;
  value: number;
  amount: number;
  borneBy: BearBorneBy;
  split: BearSplit;
  /** Whose share a doctor-borne part comes from; NULL = the visit's earning doctors. */
  doctorId: string | null;
  /** Carried unchanged from a treatment plan — agreed already, never asks (§7). */
  fromPlan: boolean;
};

function toBorneBy(v: string | null | undefined): ShareBorneBy & BearBorneBy {
  return v === "doctor" || v === "split" ? v : "clinic";
}

function toOfferBorneBy(v: string | null | undefined): OfferBorneBy {
  return v === "clinic" || v === "doctor" || v === "split" ? v : "proportional";
}

function toSplit(type: string, value: number): BearSplit {
  return { type: type === "amount" ? "amount" : "percent", value };
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
    bearingVersion: 1,
    pieces: [],
    requestedPieces: [],
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
      consultationDiscountType: appointments.consultationDiscountType,
      consultationDiscountValue: appointments.consultationDiscountValue,
      consultationDiscountHeld: appointments.consultationDiscountHeld,
      consultationBorneBy: appointments.consultationBorneBy,
      consultationSplitType: appointments.consultationSplitType,
      consultationSplitValue: appointments.consultationSplitValue,
      bearingVersion: appointments.bearingVersion,
      discountFromPlan: appointments.discountFromPlan,
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
      isService: appointmentProcedures.isService,
      offerBorneBy: appointmentProcedures.offerBorneBy,
      offerSplitType: appointmentProcedures.offerSplitType,
      offerSplitValue: appointmentProcedures.offerSplitValue,
      patientDiscountType: appointmentProcedures.patientDiscountType,
      patientDiscountValue: appointmentProcedures.patientDiscountValue,
      patientDiscountHeld: appointmentProcedures.patientDiscountHeld,
      discountBorneBy: appointmentProcedures.discountBorneBy,
      discountSplitType: appointmentProcedures.discountSplitType,
      discountSplitValue: appointmentProcedures.discountSplitValue,
      discountFromPlan: appointmentProcedures.discountFromPlan,
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
      [consultDoctorId, ...procRows.map((r) => (r.isService ? null : r.doctorId))].filter(
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
  //
  // A SERVICE line (room, medicines, a one-off charge) earns no doctor share at all
  // (owner's call, 2026-10-13) — it stays in the lines so the bill and the discount
  // split still see it, with no doctor and a 0% rate, so the clinic keeps all of it.
  const lines = procRows.map((r) => {
    const doctorId = r.isService ? null : r.doctorId;
    const rate = doctorId ? rates.get(doctorId) : undefined;
    // The OFFER alone — a line's patient discount is a piece (version 2), never
    // part of the share base.
    const line = computeProcedureLine({
      unitPrice: r.unitPrice,
      quantity: r.quantity,
      discountType: normalizeDiscountType(r.discountType),
      discountValue: r.discountValue,
    });
    return {
      doctorId,
      gross: Math.max(0, line.net),
      pct: rate ? resolveProcedureRate(rate, r.procedureId) : 0,
      lineRef: r.id,
      label: r.name,
    };
  });

  // The patient's net (both requested and approval-gated). EVERY discount column is
  // read whatever the version, so this stays the bill the SQL computes
  // (bill-sql.ts); on a version-1 visit the per-line ones are simply 0.
  const discountType = normalizeDiscountType(appt.discountType);
  const lineInputs = (gated: boolean) =>
    procRows.map((r) => ({
      unitPrice: r.unitPrice,
      quantity: r.quantity,
      discountType: normalizeDiscountType(r.discountType),
      discountValue: r.discountValue,
      patientDiscountType: normalizeDiscountType(r.patientDiscountType),
      patientDiscountValue: gated && r.patientDiscountHeld ? 0 : r.patientDiscountValue,
    }));
  const consultationDiscount = (gated: boolean) => ({
    type: normalizeDiscountType(appt.consultationDiscountType),
    value: gated && appt.consultationDiscountHeld ? 0 : appt.consultationDiscountValue,
  });
  const requested = computeBill(
    consultFee,
    lineInputs(false),
    discountType,
    appt.discountValue,
    consultationDiscount(false),
  );
  const netRequested = requested.net;
  const effective = computeBill(
    consultFee,
    lineInputs(true),
    discountType,
    effectiveDiscountValue(appt.discountStatus, appt.discountValue),
    consultationDiscount(true),
  );
  const netEffective = effective.net;

  // VERSION 2 — per line (docs/per-line-discount-plan.md §3). Each effective discount
  // becomes a piece with its own bearer; an offer "in proportion" lowers its line's
  // share base instead, exactly as every offer does under version 1.
  const bearingVersion: 1 | 2 = appt.bearingVersion === 2 ? 2 : 1;
  let pieces: BearingPiece[] = [];
  if (bearingVersion === 2) {
    const effLines = lineInputs(true).map((l) => computeProcedureLine(l));
    const built = buildDiscountPieces({
      consultation: consultation
        ? {
            ...consultation,
            discount: {
              amount: effective.consultationDiscount,
              borneBy: toBorneBy(appt.consultationBorneBy),
              split: toSplit(appt.consultationSplitType, appt.consultationSplitValue),
            },
          }
        : null,
      lines: procRows.map((r, i) => ({
        doctorId: lines[i].doctorId,
        isService: r.isService,
        gross: effLines[i].gross,
        pct: lines[i].pct,
        offer: {
          amount: effLines[i].offerDiscount,
          borneBy: toOfferBorneBy(r.offerBorneBy),
          split: toSplit(r.offerSplitType, r.offerSplitValue),
        },
        patient: {
          amount: effLines[i].patientDiscount,
          borneBy: toBorneBy(r.discountBorneBy),
          split: toSplit(r.discountSplitType, r.discountSplitValue),
        },
      })),
      overall: {
        amount: effective.appointmentDiscount,
        borneBy: toBorneBy(appt.discountBorneBy),
        split: toSplit(appt.discountSplitType, appt.discountSplitValue),
      },
    });
    // Share bases move (a borne offer no longer lowers its line's); refs and labels
    // stay with their line.
    built.lines.forEach((b, i) => {
      lines[i].gross = b.gross;
    });
    pieces = built.pieces;
  }

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
    bearingVersion,
    pieces,
    requestedPieces: requestedPiecesOf(),
  };

  // The requested (ungated) patient discounts, in rupees. A line no doctor earns from
  // is the clinic's, whatever was chosen — the same rule bearing applies.
  function requestedPiecesOf(): RequestedPiece[] {
    const out: RequestedPiece[] = [];
    const reqLines = lineInputs(false).map((l) => computeProcedureLine(l));
    const clinicOwned = (doctorId: string | null) => !doctorId || !earnerDoctorIds.includes(doctorId);
    const piece = (
      key: string,
      label: string,
      raw: { type: string; value: number },
      amount: number,
      doctorId: string | null,
      bearer: string,
      split: BearSplit,
      fromPlan: boolean,
      named: boolean,
    ) => {
      if (!(amount > 0)) return;
      const toClinic = named && clinicOwned(doctorId);
      out.push({
        key,
        label,
        type: normalizeDiscountType(raw.type),
        value: raw.value,
        amount,
        borneBy: toClinic ? "clinic" : toBorneBy(bearer),
        split,
        doctorId: named && !toClinic ? doctorId : null,
        fromPlan,
      });
    };
    if (consultation) {
      piece("consultation", "Consultation",
        { type: appt!.consultationDiscountType, value: appt!.consultationDiscountValue }, requested.consultationDiscount, consultation.doctorId,
        appt!.consultationBorneBy, toSplit(appt!.consultationSplitType, appt!.consultationSplitValue), false, true);
    }
    procRows.forEach((r, i) => {
      piece(r.id, r.name, { type: r.patientDiscountType, value: r.patientDiscountValue }, reqLines[i].patientDiscount, r.isService ? null : r.doctorId,
        r.discountBorneBy, toSplit(r.discountSplitType, r.discountSplitValue), r.discountFromPlan, true);
    });
    piece("overall", "Whole visit", { type: appt!.discountType, value: appt!.discountValue }, requested.appointmentDiscount, null, appt!.discountBorneBy,
      toSplit(appt!.discountSplitType, appt!.discountSplitValue), appt!.discountFromPlan, false);
    return out;
  }
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
