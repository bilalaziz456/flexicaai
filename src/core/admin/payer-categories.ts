/**
 * How late a subscription month was settled, as a named band — CORE, client-safe.
 *
 * A CONSTANT, not a reference table. ADR-027's test is whether a bad value produces a
 * wrong FIGURE silently; these produce a wrong LABEL on a scorecard, and every one of
 * them is a branch the code takes (`categoryFor` decides which applies), so the code
 * owns the meaning. Adding a band is a deploy either way.
 *
 * The day thresholds are the interesting part and they are ours to defend:
 *   early     paid ahead of the due date — the clinic is not thinking about us at all
 *   on_time   settled on the due date
 *   delayed   1–5 days — an admin was on leave; not a signal
 *   overdue   6–10 days — needed a reminder
 *   defaulter later than that, but still inside the month it was due
 *   outstanding  the due month came and went unpaid — the only band that is not about
 *                lateness but about non-payment, and the only one that can still change
 *
 * `score` drives the 0–5 rating. The gaps are uneven on purpose: the distance from
 * "needed a reminder" to "did not pay that month" is larger than the distance between
 * two flavours of on-time.
 */
export const PAYER_CATEGORIES = [
  { code: "early", label: "Early Payer", score: 5, hint: "Paid before the due date" },
  { code: "on_time", label: "On-Time Payer", score: 4, hint: "Paid on the due date" },
  { code: "delayed", label: "Delayed Payer", score: 3, hint: "Paid 1–5 days after the due date" },
  { code: "overdue", label: "Overdue Payer", score: 2, hint: "Paid 6–10 days after the due date" },
  { code: "defaulter", label: "Defaulter", score: 1, hint: "Paid after 10 days, within the due month" },
  { code: "outstanding", label: "Outstanding Payer", score: 0, hint: "Unpaid beyond the due month" },
] as const;

export type PayerCategory = (typeof PAYER_CATEGORIES)[number]["code"];

const META = new Map(PAYER_CATEGORIES.map((c) => [c.code as string, c]));

export function payerLabel(code: string): string {
  return META.get(code)?.label ?? code;
}

/**
 * The band for one month.
 *
 * `daysLate === null` means the month was never covered. That is NOT automatically
 * "outstanding": a month that came due yesterday and is unpaid is simply not paid yet,
 * and grading it as the worst band would drop a clinic's whole rating the morning its
 * invoice fell due. So an unpaid month only becomes `outstanding` once its own month
 * has passed — which is exactly what the label says.
 */
export function categoryFor(daysLate: number | null, dueAt: Date, now: Date): PayerCategory {
  if (daysLate === null) {
    const monthEnd = new Date(dueAt.getFullYear(), dueAt.getMonth() + 1, 1);
    return now.getTime() >= monthEnd.getTime() ? "outstanding" : "defaulter";
  }
  if (daysLate < 0) return "early";
  if (daysLate === 0) return "on_time";
  if (daysLate <= 5) return "delayed";
  if (daysLate <= 10) return "overdue";
  return "defaulter";
}

export type Grade = "good" | "average" | "poor" | "critical";

/** The headline word. Bands chosen so "good" needs most months on time, not merely paid. */
export function gradeFor(rating: number | null): Grade | null {
  if (rating === null) return null;
  if (rating >= 3.5) return "good";
  if (rating >= 2.5) return "average";
  if (rating >= 1.5) return "poor";
  return "critical";
}

export const GRADE_META: Record<Grade, { label: string; tone: "good" | "warn" | "bad" }> = {
  good: { label: "GOOD", tone: "good" },
  average: { label: "AVERAGE", tone: "warn" },
  poor: { label: "POOR", tone: "warn" },
  critical: { label: "CRITICAL", tone: "bad" },
};

/** Risk wording for the card, from the current band and how much is unpaid. */
export function riskFor(
  current: PayerCategory | null,
  unpaidMonths: number,
): { label: string; tone: "good" | "warn" | "bad" } {
  if (unpaidMonths >= 3 || current === "outstanding") return { label: "Critical risk", tone: "bad" };
  if (unpaidMonths > 0 || current === "defaulter") return { label: "At risk", tone: "warn" };
  if (current === "overdue" || current === "delayed") return { label: "Watch", tone: "warn" };
  return { label: "No risk", tone: "good" };
}
