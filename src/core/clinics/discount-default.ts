import { z } from "zod";
import { resolveProcedureRate, type DoctorShareRates } from "@/core/appointments/shares";

/**
 * Who bears a NEW patient discount until someone picks otherwise — the clinic's
 * setting (owner, 2026-11-11; `clinics.default_discount_borne_by_id`). Pure, so the
 * Settings form, the server action and the booking form share one shape.
 *
 * Only a STARTING choice: a discount box opens on it, and every discount still shows
 * Clinic / Doctor / Split and keeps what was picked on it. A doctor-borne part still
 * waits for that doctor's approval, exactly as when it is picked by hand.
 *
 * A SPLIT's doctor part follows the doctor's own share (owner, 2026-11-11): a doctor
 * who earns 20% of a procedure bears 20% of its discount, one who earns 0% bears none.
 * The form fills it in as a percentage — an ordinary split, so billing, approvals and
 * settlements need nothing new — and keeps it in step with the doctor and the lines
 * until someone types their own part.
 */
export const DISCOUNT_DEFAULT_BEARERS = ["clinic", "doctor", "split"] as const;
export type DiscountDefaultBearer = (typeof DISCOUNT_DEFAULT_BEARERS)[number];

/** A clinic row's column → the default (anything unexpected reads as the clinic). */
export function discountDefaultOf(
  row: { defaultDiscountBorneBy?: string | null } | null | undefined,
): DiscountDefaultBearer {
  const b = row?.defaultDiscountBorneBy;
  return b === "doctor" || b === "split" ? b : "clinic";
}

/** The Settings form's field. */
export const discountDefaultSchema = z.object({
  borneBy: z.enum(DISCOUNT_DEFAULT_BEARERS, { message: "Choose who bears discounts." }),
});

/** Every doctor's share rates, keyed by doctor id (`DoctorShareRates`). */
export type ShareRatesByDoctor = Record<string, DoctorShareRates>;

/** The doctor's share % on a procedure — and so their part of its discount. */
export function procedureSharePart(
  rates: ShareRatesByDoctor,
  doctorId: string | null | undefined,
  procedureId: string | null,
): number {
  const r = doctorId ? rates[doctorId] : undefined;
  return r ? resolveProcedureRate(r, procedureId) : 0;
}

/** The doctor's consultation share % — and so their part of its discount. */
export function consultationSharePart(rates: ShareRatesByDoctor, doctorId: string | null | undefined): number {
  const r = doctorId ? rates[doctorId] : undefined;
  return r ? r.consultationPct : 0;
}

/**
 * The doctor's part of a discount on several lines at once (the whole visit, or a
 * treatment plan): the share each line earns, weighted by what the line costs, so it
 * is the doctor's share of the bill. A line with no doctor share (a service, a
 * one-off charge) weighs in at 0%.
 */
export function weightedSharePart(lines: { amount: number; pct: number }[]): number {
  const total = lines.reduce((s, l) => s + Math.max(0, l.amount), 0);
  if (total <= 0) return 0;
  const earned = lines.reduce((s, l) => s + Math.max(0, l.amount) * Math.max(0, Math.min(100, l.pct)), 0);
  return Math.round(earned / total);
}
