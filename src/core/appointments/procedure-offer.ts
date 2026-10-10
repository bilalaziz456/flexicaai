import { formatPkr, MAX_DISCOUNT_PERCENT, type DiscountType } from "@/core/appointments/fee";

/**
 * CLINIC OFFERS — a discount the clinic gives every patient on a procedure, for a
 * range of visit dates. PURE (no DB, no `server-only`), because the booking form's
 * live preview and the server's booking write must agree on whether an offer applies
 * — the same reason `fee.ts` is pure (conventions §3).
 *
 * An offer is NOT a patient discount. A patient discount is a decision about one
 * person and may need approval; an offer is the clinic's own standing decision, made
 * once on the Procedures page, so it never asks. It reaches the bill as the procedure
 * LINE's discount (`appointment_procedures.discount_*`), snapshotted at booking, which
 * is how the bill, invoice, reports and ledger already handle a line discount.
 */
export type ProcedureOffer = {
  type: DiscountType;
  /** PKR for "amount", 0–100 for "percent". 0 = no offer. */
  value: number;
  /** "YYYY-MM-DD", inclusive. null = from now on. */
  startsOn: string | null;
  /** "YYYY-MM-DD", inclusive. null = no end date. */
  endsOn: string | null;
};

export type OfferStatus = "none" | "scheduled" | "active" | "ended";

/** Where an offer stands on `date` ("YYYY-MM-DD") — the Procedures page's badge. */
export function offerStatus(offer: ProcedureOffer, date: string): OfferStatus {
  if (!(offer.value > 0)) return "none";
  if (offer.startsOn && date < offer.startsOn) return "scheduled";
  if (offer.endsOn && date > offer.endsOn) return "ended";
  return "active";
}

/**
 * The discount this offer puts on a line for a visit on `visitDate`, or null when it
 * does not apply. The VISIT date decides, not the day it was booked: "20% off in
 * October" means visits in October, which is also what the patient is told.
 */
export function offerForVisit(
  offer: ProcedureOffer,
  visitDate: string,
): { type: DiscountType; value: number } | null {
  if (offerStatus(offer, visitDate) !== "active") return null;
  const value = offer.type === "percent" ? Math.min(offer.value, MAX_DISCOUNT_PERCENT) : offer.value;
  return { type: offer.type, value };
}

/** "20% off" / "Rs 500 off". */
export function describeOfferAmount(type: DiscountType, value: number): string {
  return type === "percent" ? `${value}% off` : `${formatPkr(value)} off`;
}

const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** "20% off · 15 Oct 2026 – 31 Oct 2026" / "Rs 500 off · from 15 Oct 2026, no end date". */
export function describeOffer(offer: ProcedureOffer): string {
  const amount = describeOfferAmount(offer.type, offer.value);
  if (offer.startsOn && offer.endsOn) return `${amount} · ${fmtDay(offer.startsOn)} – ${fmtDay(offer.endsOn)}`;
  if (offer.endsOn) return `${amount} · until ${fmtDay(offer.endsOn)}`;
  if (offer.startsOn) return `${amount} · from ${fmtDay(offer.startsOn)}, no end date`;
  return `${amount} · no end date`;
}

/** "10% discount" / "Rs 500 discount" — how a line's offer is worded on a bill. */
export function describeOfferDiscount(type: DiscountType, value: number): string {
  return type === "percent" ? `${value}% discount` : `${formatPkr(value)} discount`;
}

/** "Clinic002 offer" — staff screens name WHOSE offer it is, the clinic's own name
 *  rather than the generic word (owner's call). Falls back when no name is known. */
export function offerLabel(clinicName: string | null | undefined): string {
  const name = clinicName?.trim();
  return name ? `${name} offer` : "Clinic offer";
}
