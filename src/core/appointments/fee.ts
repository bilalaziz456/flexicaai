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

/**
 * The discount that ACTUALLY applies given its approval status. A discount awaiting
 * approval ('pending') or declined ('rejected') is treated as 0 everywhere the bill
 * is computed — the bill/sale/split behave as if there were no discount until it's
 * approved. 'none' (the default) and 'approved' apply the discount in full. Pure.
 */
export function effectiveDiscountValue(
  discountStatus: string | null | undefined,
  discountValue: number,
): number {
  return discountStatus === "pending" || discountStatus === "rejected"
    ? 0
    : discountValue;
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

/** One procedure line's discount inputs. */
export type ProcedureLineInput = {
  unitPrice: number;
  quantity: number;
  discountType: DiscountType;
  discountValue: number;
};

export type ProcedureLineTotal = {
  gross: number; // unitPrice × quantity
  discount: number; // clamped per-line discount
  net: number; // gross − discount
};

/**
 * A single procedure line's totals — its gross (unit × qty) less its own discount,
 * clamped to the line. Pure; the per-line discount is applied BEFORE the
 * appointment-level discount.
 */
export function computeProcedureLine(line: ProcedureLineInput): ProcedureLineTotal {
  const unit = Math.max(0, Math.round(line.unitPrice || 0));
  const qty = Math.max(0, Math.round(line.quantity || 0));
  const gross = unit * qty;
  const { discount, net } = computeFee(gross, line.discountType, line.discountValue);
  return { gross, discount, net };
}

export type BillTotal = {
  consultation: number;
  proceduresGross: number; // Σ line gross (pre any discount)
  proceduresDiscount: number; // Σ per-line discounts
  proceduresNet: number; // Σ line nets
  subtotal: number; // consultation + proceduresNet
  appointmentDiscount: number; // discount on the subtotal
  gross: number; // consultation + proceduresGross (true pre-discount)
  discount: number; // proceduresDiscount + appointmentDiscount
  net: number; // what the patient pays
  lines: ProcedureLineTotal[];
};

/**
 * The full appointment bill with per-line discounts AND an overall appointment
 * discount: each line is discounted first, summed with the consultation fee into a
 * subtotal, then the appointment discount is applied to that subtotal. Pure.
 */
export function computeBill(
  consultationFee: number | null | undefined,
  lines: ProcedureLineInput[],
  appointmentDiscountType: DiscountType,
  appointmentDiscountValue: number,
): BillTotal {
  const consultation =
    consultationFee && consultationFee > 0 ? Math.round(consultationFee) : 0;
  const lineTotals = lines.map(computeProcedureLine);
  const proceduresGross = lineTotals.reduce((s, l) => s + l.gross, 0);
  const proceduresDiscount = lineTotals.reduce((s, l) => s + l.discount, 0);
  const proceduresNet = lineTotals.reduce((s, l) => s + l.net, 0);
  const subtotal = consultation + proceduresNet;
  const { discount: appointmentDiscount } = computeFee(
    subtotal,
    appointmentDiscountType,
    appointmentDiscountValue,
  );
  return {
    consultation,
    proceduresGross,
    proceduresDiscount,
    proceduresNet,
    subtotal,
    appointmentDiscount,
    gross: consultation + proceduresGross,
    discount: proceduresDiscount + appointmentDiscount,
    net: subtotal - appointmentDiscount,
    lines: lineTotals,
  };
}

/**
 * The three snapshot amounts the sales ledger stores, from pre-summed procedure
 * gross + net (so it stays a single aggregate query). Keeps the invariant
 * gross − discount = net while counting BOTH line and appointment discounts. Pure.
 */
export function computeSaleAmounts(
  consultationFee: number | null | undefined,
  proceduresGross: number,
  proceduresNet: number,
  appointmentDiscountType: DiscountType,
  appointmentDiscountValue: number,
): { gross: number; discount: number; net: number } {
  const consultation =
    consultationFee && consultationFee > 0 ? Math.round(consultationFee) : 0;
  const pGross = Math.max(0, Math.round(proceduresGross || 0));
  const pNet = Math.max(0, Math.round(proceduresNet || 0));
  const lineDiscount = Math.max(0, pGross - pNet);
  const subtotal = consultation + pNet;
  const { discount: appointmentDiscount } = computeFee(
    subtotal,
    appointmentDiscountType,
    appointmentDiscountValue,
  );
  return {
    gross: consultation + pGross,
    discount: lineDiscount + appointmentDiscount,
    net: subtotal - appointmentDiscount,
  };
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
