import { computeFee, computeProcedureLine, type DiscountType } from "@/core/appointments/fee";

/**
 * A treatment plan's money — CORE and PURE (no DB, no `server-only`), because the
 * plan editor, the printed estimate and the booking form must all arrive at the same
 * figures (conventions §3, the reason `fee.ts` is pure).
 *
 * Each item, in order: its price × quantity, less the clinic OFFER it was added with,
 * less the item's own plan discount (taken off what is left after the offer). The
 * plan's OVERALL discount then comes off the subtotal of those. Same layering as a
 * visit's bill — line discounts first, the overall one on the subtotal — and built
 * from the same `computeFee`, so a plan line and the visit line it becomes cannot
 * disagree about what a percentage is worth.
 *
 * The overall discount is also ALLOCATED back to the items, in proportion to each
 * item's net, so a visit booked with some of the items carries exactly its share
 * (`planDiscount`). The allocation sums to the overall discount to the rupee
 * (largest remainder), whichever subset of items is later booked.
 */

export type PlanBearer = "clinic" | "doctor" | "split";

export type PlanItemInput = {
  unitPrice: number;
  quantity: number;
  offerType: DiscountType;
  offerValue: number;
  discountType: DiscountType;
  discountValue: number;
  /** A cancelled item is shown but costs nothing and takes no share of the discount. */
  cancelled?: boolean;
};

export type PlanItemTotal = {
  gross: number;
  offer: number;
  /** The item's own plan discount, in PKR. */
  discount: number;
  /** gross − offer − discount: what the item costs before the overall discount. */
  net: number;
  /** This item's share of the overall discount. */
  overallShare: number;
  /** The plan discount a visit booked with this item carries: own + overall share. */
  planDiscount: number;
};

export type PlanBill = {
  items: PlanItemTotal[];
  gross: number;
  offers: number;
  itemDiscounts: number;
  /** Σ item nets. */
  subtotal: number;
  overallDiscount: number;
  /** subtotal − overallDiscount: what the patient pays for the whole plan. */
  total: number;
  /** Everything the PLAN gives (item + overall), excluding the clinic's offers. */
  planDiscount: number;
};

export function computePlanBill(
  items: PlanItemInput[],
  overall: { type: DiscountType; value: number },
): PlanBill {
  const lines = items.map((it) => {
    if (it.cancelled) return { gross: 0, offer: 0, discount: 0, net: 0 };
    const offered = computeProcedureLine({
      unitPrice: it.unitPrice,
      quantity: it.quantity,
      discountType: it.offerType,
      discountValue: it.offerValue,
    });
    const own = computeFee(offered.net, it.discountType, it.discountValue);
    return { gross: offered.gross, offer: offered.discount, discount: own.discount, net: own.net };
  });

  const subtotal = lines.reduce((s, l) => s + l.net, 0);
  const overallDiscount = computeFee(subtotal, overall.type, overall.value).discount;
  const shares = allocate(overallDiscount, lines.map((l) => l.net));

  const out = lines.map((l, i) => ({
    ...l,
    overallShare: shares[i],
    planDiscount: l.discount + shares[i],
  }));
  const itemDiscounts = out.reduce((s, l) => s + l.discount, 0);
  return {
    items: out,
    gross: out.reduce((s, l) => s + l.gross, 0),
    offers: out.reduce((s, l) => s + l.offer, 0),
    itemDiscounts,
    subtotal,
    overallDiscount,
    total: subtotal - overallDiscount,
    planDiscount: itemDiscounts + overallDiscount,
  };
}

/**
 * Split `total` across `weights` in proportion, in whole rupees, summing to `total`
 * exactly: floor each share, then hand the leftover rupees to the largest remainders
 * (earliest first on a tie, so the result is stable).
 */
function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const floors = exact.map(Math.floor);
  let left = total - floors.reduce((s, f) => s + f, 0);
  const order = exact
    .map((e, i) => ({ i, r: e - Math.floor(e) }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

/**
 * The doctor's part of a SPLIT plan discount, carried onto a visit that takes
 * `visitDiscount` of the plan's `planDiscount`. A percentage carries as it is; a flat
 * amount is the doctor's part of the WHOLE plan, so a visit takes it in proportion.
 */
export function splitForVisit(
  split: { type: DiscountType; value: number },
  planDiscount: number,
  visitDiscount: number,
): { type: DiscountType; value: number } {
  if (split.type === "percent") return split;
  if (planDiscount <= 0) return { type: "amount", value: 0 };
  return { type: "amount", value: Math.min(visitDiscount, Math.round((split.value * visitDiscount) / planDiscount)) };
}

/**
 * Who a plan's discount is from, as printed: "Dr. Sana Ali", "Smile Dental", or
 * "Dr. Sana Ali and Smile Dental". A doctor discount with no doctor chosen says "the
 * doctor" rather than printing a blank.
 */
export function discountByLabel(
  bearer: PlanBearer,
  doctorName: string | null | undefined,
  clinicName: string | null | undefined,
): string {
  const doctor = doctorName?.trim() || "the doctor";
  const clinic = clinicName?.trim() || "the clinic";
  if (bearer === "doctor") return doctor;
  if (bearer === "split") return `${doctor} and ${clinic}`;
  return clinic;
}

/** One booked plan item's contribution to its visit's discount. */
export type PlanItemDiscountCarry = {
  planId: string;
  planDiscount: number;
  borneBy: PlanBearer;
  split: { type: DiscountType; value: number };
  planDiscountTotal: number;
};

export type VisitPlanDiscount = {
  amount: number;
  borneBy: PlanBearer;
  split: { type: DiscountType; value: number };
};

/**
 * The patient discount a visit takes from the plan items booked on it: their plan
 * discounts summed, with the plan's "Discount by". Null when they carry none. An error
 * when they come from plans whose discount is given differently — one visit has ONE
 * "Discount borne by", so those are booked on separate visits. Shared by the booking
 * form's preview and the server, so the two cannot disagree.
 */
export function visitPlanDiscount(items: PlanItemDiscountCarry[]): VisitPlanDiscount | { error: string } | null {
  const giving = items.filter((c) => c.planDiscount > 0);
  const amount = giving.reduce((s, c) => s + c.planDiscount, 0);
  if (amount <= 0) return null;
  const first = giving[0];
  const mixed = giving.some(
    (c) => c.borneBy !== first.borneBy || (first.borneBy === "split" && c.planId !== first.planId),
  );
  if (mixed) {
    return { error: "These items come from plans whose discount is given by different people. Book them on separate visits." };
  }
  return {
    amount,
    borneBy: first.borneBy,
    split: first.borneBy === "split" ? splitForVisit(first.split, first.planDiscountTotal, amount) : { type: "percent", value: 0 },
  };
}

/**
 * Is the discount on a booking exactly the one its plan items carry? Then it is the
 * plan's agreed discount and needs no approval; anything else the desk typed is an
 * ordinary patient discount and follows the approval rules.
 */
export function isPlanDiscount(
  plan: VisitPlanDiscount | null,
  d: { discountType: DiscountType; discountValue: number; borneBy: string; splitType: DiscountType; splitValue: number },
): boolean {
  if (!plan) return false;
  if (d.discountType !== "amount" || d.discountValue !== plan.amount || d.borneBy !== plan.borneBy) return false;
  return plan.borneBy !== "split" || (d.splitType === plan.split.type && d.splitValue === plan.split.value);
}
