/**
 * An appointment's PAYMENT status — "how much has this patient paid?" — shown as a
 * badge beside the visit status (owner's call, 2026-10-12). The two answer different
 * questions and stay separate: the visit status drives the queue and the sales ledger
 * (completed = seen), while payment can happen before, during or after the visit.
 *
 * DERIVED, never set by hand. Every payment, refund or cancelled payment recomputes
 * `appointments.amount_collected` (net of refunds), and a change to the bill moves the
 * status on its own — so the badge cannot disagree with the payment records. PURE (no
 * DB), so the list, the appointment page and the printout all use this one function.
 */
/** The Badge colours this uses (core/ui/badge.tsx). */
export type PaymentBadgeVariant = "success" | "info" | "warning" | "destructive" | "outline";

export type VisitPaymentStatus =
  | "not_paid"
  | "advance_paid"
  | "partially_paid"
  | "paid"
  | "refund_due"
  | "refunded";

export function visitPaymentStatus(input: {
  /** The bill after every discount (`computeBill(...).net`). */
  bill: number;
  /** `amount_collected` — payments + advance applied, minus refunds. */
  collected: number;
  /** Σ refunds recorded against this visit. */
  refunded: number;
  visitStatus: string;
}): VisitPaymentStatus | null {
  const { bill, collected, refunded, visitStatus } = input;
  // A visit that will not happen: what matters is whether money is still held.
  if (visitStatus === "cancelled" || visitStatus === "no_show") {
    if (collected > 0) return "refund_due";
    return refunded > 0 ? "refunded" : null;
  }
  // Nothing to pay and nothing taken: no badge (a free follow-up, a fee not set yet).
  if (bill <= 0 && collected <= 0) return refunded > 0 ? "refunded" : null;
  if (collected <= 0) return refunded > 0 ? "refunded" : "not_paid";
  if (collected >= bill) return "paid";
  // Something taken, less than the bill: before the visit is done it is an advance,
  // after it the rest is owed.
  return visitStatus === "completed" ? "partially_paid" : "advance_paid";
}

const LABEL: Record<VisitPaymentStatus, string> = {
  not_paid: "Not paid",
  advance_paid: "Advance paid",
  partially_paid: "Partially paid",
  paid: "Paid",
  refund_due: "Refund due",
  refunded: "Refunded",
};

/** The badge: label (with what is still owed, where that helps) and a colour. */
export function paymentStatusBadge(
  status: VisitPaymentStatus,
  opts: {
    outstanding: number;
    /** Money held beyond the bill (a deposit larger than the charges so far). */
    extra?: number;
    visitStatus: string;
    formatMoney: (n: number) => string;
  },
): { label: string; variant: PaymentBadgeVariant } {
  const left = opts.outstanding > 0 ? ` · ${opts.formatMoney(opts.outstanding)} left` : "";
  switch (status) {
    case "paid":
      // A deposit bigger than the charges so far is still "paid" — nothing is owed —
      // but the extra is named, because at discharge it is refunded or kept as credit
      // (the payment panel's Settle step). Amber, not green: something is left to do.
      return (opts.extra ?? 0) > 0
        ? { label: `${LABEL.paid} · ${opts.formatMoney(opts.extra!)} extra`, variant: "warning" }
        : { label: LABEL.paid, variant: "success" };
    case "advance_paid":
      return { label: `${LABEL.advance_paid}${left}`, variant: "info" };
    case "partially_paid":
      return { label: `${LABEL.partially_paid}${left}`, variant: "warning" };
    case "refund_due":
      return { label: LABEL.refund_due, variant: "destructive" };
    case "refunded":
      return { label: LABEL.refunded, variant: "outline" };
    case "not_paid":
      // Always red (owner's call, 2026-10-13): the visit status runs the queue and no
      // longer decides anything about money, so "nothing paid yet" reads the same
      // before and after the visit.
      return { label: LABEL.not_paid, variant: "destructive" };
  }
}

/** Every status, in the order a filter offers them. */
export const VISIT_PAYMENT_STATUSES: readonly VisitPaymentStatus[] = [
  "not_paid",
  "advance_paid",
  "partially_paid",
  "paid",
  "refund_due",
  "refunded",
];

export const VISIT_PAYMENT_STATUS_LABEL = LABEL;

/** Narrows an untrusted value (a URL param) to a status, or undefined. */
export function asVisitPaymentStatus(v: string | null | undefined): VisitPaymentStatus | undefined {
  return (VISIT_PAYMENT_STATUSES as readonly string[]).includes(v ?? "") ? (v as VisitPaymentStatus) : undefined;
}
