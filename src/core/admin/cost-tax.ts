/**
 * International-transaction bank tax/charges — PURE, CLIENT-SAFE (no server-only, no DB).
 * Shared by the serving-cost calc (server) and the rate form's live preview (client) so
 * the effective % can never drift between them. See core/admin/cost.ts.
 *
 * A Pakistani bank adds these when FlexicaAI pays the AI/WhatsApp providers in USD:
 *  - foreign-transaction fee — a % of the payment;
 *  - FED (Federal Excise Duty) — a % **of that fee**, so its contribution to the payment
 *    is `fee × FED%` (e.g. 16% FED on a 3% fee = 0.48% of the payment);
 *  - advance tax — a % of the payment (adjustable against the annual return for filers);
 *  - additional — any other flat % of the payment.
 * Or, in 'total' mode, a single combined % read straight off a statement.
 */

export type TaxShape = {
  taxMode: "itemized" | "total";
  foreignTxnFeePct: number;
  fedPct: number;
  advanceTaxPct: number;
  additionalTaxPct: number;
  totalTaxPct: number;
};

/**
 * Effective markup % of the payment. Itemised = fee + (FED **on the fee**) + advance +
 * additional; total = the single figure. PURE.
 */
export function effectiveTaxPct(t: TaxShape): number {
  if (t.taxMode === "total") return t.totalTaxPct;
  const fedOnFee = (t.foreignTxnFeePct * t.fedPct) / 100;
  return t.foreignTxnFeePct + fedOnFee + t.advanceTaxPct + t.additionalTaxPct;
}

/** PKR multiplier for the bank tax/charges (1 + effective%/100). PURE. */
export function taxMultiplier(t: TaxShape): number {
  return 1 + effectiveTaxPct(t) / 100;
}

/**
 * Ballpark itemised defaults for a PAKISTANI FILER, offered as the form's starting
 * point (editable). VERIFY against a real card/bank statement — these change with every
 * budget and vary by bank. Effective ≈ 3 + (3×16%) + 5 = 8.48%.
 *   foreign-txn fee ~3% · FED 16% (of the fee) · advance tax ~5% (filer) · additional 0.
 */
export const FILER_TAX_DEFAULTS = {
  taxMode: "itemized" as const,
  foreignTxnFeePct: 3,
  fedPct: 16,
  advanceTaxPct: 5,
  additionalTaxPct: 0,
};
