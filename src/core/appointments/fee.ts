/**
 * Consultation-fee + discount maths — CORE, specialty-agnostic and PURE (no DB,
 * no server-only imports) so both server actions and the client scheduling form
 * can share one source of truth. All figures are whole PKR.
 *
 * A discount is either a flat amount (default) or a percentage of the fee. The
 * net is always clamped to [0, fee] so a discount can never make the patient's
 * fee negative or exceed the fee itself. A 0/absent fee means "not set" → the
 * net is 0 and no discount applies.
 */

export type DiscountType = "amount" | "percent";

/** Coerce arbitrary stored/user input to a valid discount type ('amount' default). */
export function normalizeDiscountType(v: string | null | undefined): DiscountType {
  return v === "percent" ? "percent" : "amount";
}

export type FeeBreakdown = {
  /** The doctor's consultation fee (0 = not set). */
  fee: number;
  /** The effective discount applied, in PKR, clamped to [0, fee]. */
  discount: number;
  /** Fee minus the discount — what the patient actually pays. */
  net: number;
};

/**
 * Net fee after a discount. `discountValue` is the raw figure: PKR for
 * 'amount', or a percentage (0–100) for 'percent'.
 */
export function computeFee(
  fee: number | null | undefined,
  discountType: DiscountType,
  discountValue: number,
): FeeBreakdown {
  const base = fee && fee > 0 ? Math.round(fee) : 0;
  if (base === 0) return { fee: 0, discount: 0, net: 0 };

  const value = Number.isFinite(discountValue) ? discountValue : 0;
  const raw =
    discountType === "percent"
      ? Math.round((base * value) / 100)
      : Math.round(value);
  const discount = Math.max(0, Math.min(raw, base));
  return { fee: base, discount, net: base - discount };
}

/** "Rs 1,500". */
export function formatPkr(n: number): string {
  return `Rs ${new Intl.NumberFormat("en-PK").format(Math.max(0, Math.round(n)))}`;
}

export type AppointmentTotal = {
  consultation: number;
  procedures: number;
  gross: number; // consultation + procedures, before discount
  discount: number;
  net: number; // what the patient pays
};

/**
 * Full appointment bill: the doctor's consultation fee PLUS the selected
 * procedures, with the discount applied to that combined total. Pure — shared by
 * the booking form, the lists, and the WhatsApp confirmation.
 */
export function computeAppointmentTotal(
  consultationFee: number | null | undefined,
  proceduresTotal: number,
  discountType: DiscountType,
  discountValue: number,
): AppointmentTotal {
  const consultation =
    consultationFee && consultationFee > 0 ? Math.round(consultationFee) : 0;
  const procs = Math.max(0, Math.round(proceduresTotal || 0));
  const gross = consultation + procs;
  // Reuse the same discount clamp against the combined total.
  const { discount, net } = computeFee(gross, discountType, discountValue);
  return { consultation, procedures: procs, gross, discount, net };
}
