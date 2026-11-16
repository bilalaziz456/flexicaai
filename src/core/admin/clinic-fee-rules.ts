/**
 * One-time fees — the PURE rules (no DB, no `server-only`), shared by the clinic page,
 * the invoice form, the printout and the server (owner, 2026-11-17).
 *
 * A fee (training, implementation…) is owed ON TOP of the subscription and is kept
 * apart from it. Each payment records how much of it was for fees
 * (`clinic_payments.fee_amount`); the subscription balance reads only the rest, so fee
 * money is never counted as months paid.
 */

export const FEE_KINDS = [
  { code: "training", label: "Training" },
  { code: "implementation", label: "Implementation" },
  { code: "data_migration", label: "Data migration" },
  { code: "other", label: "Other" },
] as const;

export type FeeKind = (typeof FEE_KINDS)[number]["code"];

export function isFeeKind(v: string): v is FeeKind {
  return FEE_KINDS.some((k) => k.code === v);
}

/** "Training", or the stored code if this app no longer knows it. */
export function feeKindLabel(code: string): string {
  return FEE_KINDS.find((k) => k.code === code)?.label ?? code;
}

/** A fee's line on an invoice: its kind, and its description when it has one. */
export function feeLineLabel(kind: string, description: string | null | undefined): string {
  const d = description?.trim();
  return d ? `${feeKindLabel(kind)} — ${d}` : feeKindLabel(kind);
}

/**
 * The part of a ledger entry that counts toward the SUBSCRIPTION. A credit is never
 * fee money; anything else gives its fee share to the fees. Clamped so a bad row can
 * never make the subscription share negative or larger than the entry.
 */
export function subscriptionShare(p: { amount: number; feeAmount?: number | null; kind?: string }): number {
  if (p.kind === "credit") return p.amount;
  const fee = Math.min(Math.max(0, p.feeAmount ?? 0), p.amount);
  return p.amount - fee;
}

/** The signed fee money in a ledger entry: + for a payment, − for a refund, 0 for a credit. */
export function signedFeeShare(p: { amount: number; feeAmount?: number | null; kind?: string }): number {
  if (p.kind === "credit") return 0;
  const fee = Math.min(Math.max(0, p.feeAmount ?? 0), p.amount);
  return p.kind === "refund" ? -fee : fee;
}

export type FeeWithPaid<T> = T & { paid: number; owed: number };

/**
 * Spreads the money paid for fees over the fees, oldest first (by the order given),
 * so each fee can say "paid", "Rs 5,000 owed" or "not paid". The sum of `paid` is
 * the money given, capped at the fees' total; any excess is returned as `extra`.
 */
export function allocateFeePayments<T extends { amount: number }>(
  fees: T[],
  paidForFees: number,
): { fees: FeeWithPaid<T>[]; charged: number; paid: number; owed: number; extra: number } {
  let left = Math.max(0, paidForFees);
  const out = fees.map((f) => {
    const paid = Math.min(f.amount, left);
    left -= paid;
    return { ...f, paid, owed: f.amount - paid };
  });
  const charged = fees.reduce((s, f) => s + f.amount, 0);
  const paid = out.reduce((s, f) => s + f.paid, 0);
  return { fees: out, charged, paid, owed: charged - paid, extra: left };
}

/**
 * How much of a new payment goes to fees when nobody typed a split: fees FIRST, up to
 * what is still owed on them (owner's call, 2026-11-17). Never more than the payment.
 */
export function defaultFeeShare(amount: number, feesOwed: number): number {
  return Math.max(0, Math.min(amount, feesOwed));
}
