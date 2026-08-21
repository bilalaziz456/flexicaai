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

/** The largest meaningful percentage discount — the whole thing, free of charge. */
export const MAX_DISCOUNT_PERCENT = 100;

/**
 * Is this a discount a human could have meant? A PERCENT discount above 100 isn't a
 * bigger discount, it's a typo — the maths clamps it to "free" either way, so nothing
 * downstream distinguishes 101% from 99999%. A flat AMOUNT has no upper bound here:
 * the bill it applies to isn't known at parse time, and `computeFee` clamps it to the
 * bill anyway, so a large write-off is legitimate input.
 *
 * WHY IT'S ENFORCED AT ALL, given both sides clamp: `discount_value` is an int4
 * column, and `subtotal * 99999` overflowed it — which made Postgres THROW where TS
 * quietly clamped, taking down every list that aggregates bills for that clinic
 * (ADR-021). The SQL now computes in `numeric` so it can't break, but storing a value
 * nobody meant is still how that happened. This rejects it at the door.
 *
 * Pure, so the server actions and the booking form share one rule.
 */
export function isValidDiscount(type: DiscountType, value: number): boolean {
  if (!Number.isFinite(value) || value < 0) return false;
  return type === "percent" ? value <= MAX_DISCOUNT_PERCENT : true;
}

/**
 * Coerce a discount value into the storable range: a whole number ≥ 0, and ≤ 100 when
 * it's a percentage. Use where a value arrives from a path that isn't user-facing (a
 * hidden form field, an internal caller) and rejecting it would be unhelpful; use
 * `discountError` where a person typed it and deserves to be told.
 */
export function clampDiscountValue(type: DiscountType, value: number): number {
  const n = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return type === "percent" ? Math.min(n, MAX_DISCOUNT_PERCENT) : n;
}

/** The user-facing reason a discount was refused, or null when it's fine. */
export function discountError(type: DiscountType, value: number): string | null {
  if (!Number.isFinite(value) || value < 0) return "Discount can't be negative.";
  if (type === "percent" && value > MAX_DISCOUNT_PERCENT) {
    return `A percentage discount can't be more than ${MAX_DISCOUNT_PERCENT}%.`;
  }
  return null;
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

export type BillTotals = {
  consultation: number;
  proceduresGross: number; // Σ line gross (pre any discount)
  proceduresDiscount: number; // Σ per-line discounts
  proceduresNet: number; // Σ line nets
  subtotal: number; // consultation + proceduresNet
  appointmentDiscount: number; // discount on the subtotal
  gross: number; // consultation + proceduresGross (true pre-discount)
  discount: number; // proceduresDiscount + appointmentDiscount
  net: number; // what the patient pays
};

export type BillTotal = BillTotals & { lines: ProcedureLineTotal[] };

/**
 * ═══ THE BILL. One formula, in one place. ═══
 *
 * Everything that answers "what does this visit cost?" goes through here. It used to
 * be three near-identical functions in this file plus two byte-identical SQL copies
 * elsewhere, kept in step by comments — and they had already drifted (see `gross`
 * below). `scripts/test-bill-parity.ts` now binds this to its SQL counterpart in
 * `core/appointments/bill-sql.ts`; change one without the other and it goes red.
 *
 * ORDER MATTERS, and it is the thing most easily got wrong:
 *   1. each line is discounted FIRST  → lineNet = gross − its own clamped discount
 *   2. subtotal = consultation + Σ lineNet
 *   3. the appointment discount applies to that SUBTOTAL, never to the gross
 *   4. net = subtotal − that discount, clamped so it can't go below zero
 *
 * `gross` is the TRUE pre-discount figure (consultation + Σ line gross), so the
 * invariant `gross − discount = net` always holds. The old
 * `computeAppointmentTotal` took a single pre-summed procedures number and every
 * server caller passed the NET, which made its `gross` post-line-discount: the
 * struck-through "full price" on the appointments list understated the real one, and
 * disagreed with the printed invoice. Taking gross AND net separately is what makes
 * that unrepresentable.
 *
 * Pure — no DB, no `server-only` — so the booking form and the sales ledger share it.
 */
export function billFromTotals(
  consultationFee: number | null | undefined,
  proceduresGross: number,
  proceduresNet: number,
  appointmentDiscountType: DiscountType,
  appointmentDiscountValue: number,
): BillTotals {
  const consultation =
    consultationFee && consultationFee > 0 ? Math.round(consultationFee) : 0;
  const pGross = Math.max(0, Math.round(proceduresGross || 0));
  // Net can never exceed gross; clamping here means a caller that passes them the
  // wrong way round gets a wrong-but-sane number instead of a negative discount.
  const pNet = Math.min(pGross, Math.max(0, Math.round(proceduresNet || 0)));
  const proceduresDiscount = pGross - pNet;
  const subtotal = consultation + pNet;
  const { discount: appointmentDiscount } = computeFee(
    subtotal,
    appointmentDiscountType,
    appointmentDiscountValue,
  );
  return {
    consultation,
    proceduresGross: pGross,
    proceduresDiscount,
    proceduresNet: pNet,
    subtotal,
    appointmentDiscount,
    gross: consultation + pGross,
    discount: proceduresDiscount + appointmentDiscount,
    net: subtotal - appointmentDiscount,
  };
}

/**
 * The bill from actual LINES — used where they're already loaded (the invoice, the
 * receipt, the booking form). Sums the lines, then defers to `billFromTotals`, and
 * additionally returns the per-line breakdown for rendering.
 */
export function computeBill(
  consultationFee: number | null | undefined,
  lines: ProcedureLineInput[],
  appointmentDiscountType: DiscountType,
  appointmentDiscountValue: number,
): BillTotal {
  const lineTotals = lines.map(computeProcedureLine);
  const totals = billFromTotals(
    consultationFee,
    lineTotals.reduce((s, l) => s + l.gross, 0),
    lineTotals.reduce((s, l) => s + l.net, 0),
    appointmentDiscountType,
    appointmentDiscountValue,
  );
  return { ...totals, lines: lineTotals };
}

/**
 * The three snapshot amounts the sales ledger stores, from pre-summed procedure
 * gross + net (so it stays a single aggregate query). A projection of
 * `billFromTotals` — NOT a second formula.
 */
export function computeSaleAmounts(
  consultationFee: number | null | undefined,
  proceduresGross: number,
  proceduresNet: number,
  appointmentDiscountType: DiscountType,
  appointmentDiscountValue: number,
): { gross: number; discount: number; net: number } {
  const { gross, discount, net } = billFromTotals(
    consultationFee,
    proceduresGross,
    proceduresNet,
    appointmentDiscountType,
    appointmentDiscountValue,
  );
  return { gross, discount, net };
}
