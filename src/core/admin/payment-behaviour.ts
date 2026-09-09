import { PAYER_CATEGORIES, type PayerCategory, categoryFor } from "@/core/admin/payer-categories";

/**
 * How reliably a clinic pays ITS SUBSCRIPTION — a behaviour history, not a balance.
 *
 * `/admin` already answers "who owes us how much right now". What it structurally
 * cannot show is the PATTERN: whether a clinic that is late today has always been late,
 * or has just started slipping. That difference decides whether you offer a payment
 * plan or start a churn conversation, so it is the thing worth deriving.
 *
 * PURE — no DB, no `server-only`. Takes the billing terms and the payment ledger and
 * returns the scorecard, so the same function serves the server render and any test.
 *
 * THE MODEL, and it follows the billing one exactly (`core/admin/billing.ts`):
 * billing is ADVANCE and monthly, so month N's fee is due on `billingStart + (N-1)
 * months`. Payments are applied in date order against the oldest uncovered month —
 * the same "money-based, partial payments allowed" rule `computeClinicBalance` uses.
 * A month is SETTLED on the date the running total first covers it, and its lateness
 * is that date minus its due date.
 *
 * Deliberately NOT read from `clinic_invoices`: those are issued ad hoc for clinics
 * that ask for one, so most months have none, and a scorecard that silently skipped
 * un-invoiced months would rate a clinic on a fraction of its history.
 */

export type MonthOutcome = {
  /** First day of the month being paid for. */
  period: Date;
  dueAt: Date;
  /** When the running total first covered this month, or null if it never did. */
  settledAt: Date | null;
  /** Negative = paid early. Null when never settled. */
  daysLate: number | null;
  category: PayerCategory;
  amount: number;
};

export type PaymentBehaviour = {
  months: MonthOutcome[];
  /** 0–5, the mean of each month's category score. Null when there is no history. */
  rating: number | null;
  /** Share of months settled on or before the due date. Null when no history. */
  onTimeRate: number | null;
  counts: Record<PayerCategory, number>;
  /** Months still unpaid, and what they add up to. */
  unpaidMonths: number;
  unpaidAmount: number;
  current: PayerCategory | null;
};

export type BehaviourTrend = {
  recent: number | null;
  lifetime: number | null;
  direction: "improving" | "stable" | "declining" | "unknown";
};

const MS_DAY = 86_400_000;

function addMonths(d: Date, n: number): Date {
  const out = new Date(d);
  const day = out.getDate();
  out.setMonth(out.getMonth() + n);
  // A 31st rolls into the next month; clamp so a due date stays inside its month.
  if (out.getDate() < day) out.setDate(0);
  return out;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Whole days between two dates, ignoring the time of day — a payment at 23:00 on the
 *  due date is on time, not a day late. */
function dayDiff(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / MS_DAY);
}

export function computePaymentBehaviour(
  clinic: { monthlyPrice: number; activatedAt: Date | null; createdAt: Date },
  payments: { amount: number; kind?: string; occurredAt: Date }[],
  now: Date = new Date(),
): PaymentBehaviour {
  const empty: PaymentBehaviour = {
    months: [],
    rating: null,
    onTimeRate: null,
    counts: Object.fromEntries(PAYER_CATEGORIES.map((c) => [c.code, 0])) as Record<PayerCategory, number>,
    unpaidMonths: 0,
    unpaidAmount: 0,
    current: null,
  };
  const price = clinic.monthlyPrice;
  // A clinic on no price is never billed, so it has no payment behaviour to grade —
  // distinct from one that has been billed and paid nothing.
  if (price <= 0) return empty;

  const billingStart = clinic.activatedAt ?? clinic.createdAt;
  if (billingStart.getTime() > now.getTime()) return empty;

  // Money in, oldest first. A refund takes money back out, so it must reduce the
  // running total in the order it happened — otherwise a refunded month reads as paid.
  const ledger = payments
    .map((p) => ({
      at: p.occurredAt,
      delta: p.kind === "refund" ? -p.amount : p.amount,
    }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  // The running total after each ledger entry, plus where it ends up. Both are
  // needed and they answer different questions: the series says WHEN a month was first
  // covered, the final figure says whether it is STILL covered. A single forward cursor
  // could not do this — it cannot rewind, so a refund that undoes an earlier payment
  // would leave the month it had covered marked settled for ever.
  const cumulative: number[] = [];
  let acc = 0;
  for (const l of ledger) {
    acc += l.delta;
    cumulative.push(acc);
  }
  const finalTotal = acc;

  const months: MonthOutcome[] = [];

  // Every month from billing start through the current one is billed (advance).
  for (let n = 0; ; n++) {
    const dueAt = addMonths(billingStart, n);
    if (dueAt.getTime() > now.getTime()) break;

    const needed = (n + 1) * price;
    // Still covered after everything that has happened, refunds included.
    const covered = finalTotal >= needed;
    // When it FIRST became covered — which is what lateness is measured from, and can
    // be earlier than the due date when the clinic paid several months up front.
    const firstIdx = cumulative.findIndex((c) => c >= needed);
    const settledAt = covered && firstIdx >= 0 ? ledger[firstIdx].at : null;

    const daysLate = settledAt ? dayDiff(settledAt, dueAt) : null;
    months.push({
      period: dueAt,
      dueAt,
      settledAt,
      daysLate,
      category: categoryFor(daysLate, dueAt, now),
      amount: price,
    });
  }

  if (months.length === 0) return empty;

  const counts = Object.fromEntries(PAYER_CATEGORIES.map((c) => [c.code, 0])) as Record<
    PayerCategory,
    number
  >;
  for (const m of months) counts[m.category]++;

  const scoreOf = new Map(PAYER_CATEGORIES.map((c) => [c.code, c.score]));
  const rating = months.reduce((s, m) => s + (scoreOf.get(m.category) ?? 0), 0) / months.length;
  const onTime = months.filter((m) => m.daysLate !== null && m.daysLate <= 0).length;
  const unpaid = months.filter((m) => m.settledAt === null);

  return {
    months,
    rating,
    onTimeRate: onTime / months.length,
    counts,
    unpaidMonths: unpaid.length,
    unpaidAmount: unpaid.reduce((s, m) => s + m.amount, 0),
    current: months[months.length - 1]?.category ?? null,
  };
}

/**
 * Direction of travel: the last `window` months against the whole history.
 *
 * This is the single most decision-useful number on the card, because it is the one
 * the dues list cannot express — a clinic at 2.8 that has always been 2.8 is a payment
 * habit, while a clinic at 2.8 that has been 4.5 is a relationship going wrong.
 *
 * Needs BOTH windows to have enough months, and the recent window must not simply BE
 * the whole history — comparing three months against the same three months always
 * reports "stable", which is a statement about arithmetic rather than the clinic.
 */
export function computeTrend(
  months: MonthOutcome[],
  { window = 3, minLifetime = 6 }: { window?: number; minLifetime?: number } = {},
): BehaviourTrend {
  const scoreOf = new Map(PAYER_CATEGORIES.map((c) => [c.code, c.score]));
  const mean = (list: MonthOutcome[]) =>
    list.length ? list.reduce((s, m) => s + (scoreOf.get(m.category) ?? 0), 0) / list.length : null;

  const lifetime = mean(months);
  if (months.length < Math.max(minLifetime, window + 1)) {
    return { recent: mean(months.slice(-window)), lifetime, direction: "unknown" };
  }
  const recent = mean(months.slice(-window));
  if (recent === null || lifetime === null) return { recent, lifetime, direction: "unknown" };

  // A tenth of a point either way is noise on a 0–5 scale built from whole-month
  // categories; calling that "declining" would cry wolf every other month.
  const delta = recent - lifetime;
  const direction = delta > 0.25 ? "improving" : delta < -0.25 ? "declining" : "stable";
  return { recent, lifetime, direction };
}

export type RatingWindow = {
  /** Months in the window; null is the whole history. */
  months: number | null;
  label: string;
  rating: number | null;
};

/**
 * The rating over widening windows — the comparison chart's series.
 *
 * THE STEP CHANGES WITH THE LENGTH OF THE RELATIONSHIP, because a fixed ladder is
 * wrong at both ends. Within the first year, quarters: at eight months of history a
 * 3/6/9/12 ladder has three real points, where a 6/12/18/24 one has one. Past a year,
 * half-years: a clinic three years in does not need eleven near-identical points, and
 * the eye cannot read them anyway.
 *
 * Only windows the history can actually fill are generated, so no point on the chart
 * is ever drawn from fewer months than its label claims — the "36 Months" tick on a
 * 14-month clinic is not a low bar, it is absent.
 *
 * Ordered widest-first (All Time on the left, 3 Months on the right) so the line reads
 * past → present and a decline slopes downward, the way the eye expects.
 */
export function ratingWindows(months: MonthOutcome[]): RatingWindow[] {
  const total = months.length;
  const scoreOf = new Map(PAYER_CATEGORIES.map((c) => [c.code, c.score]));
  const mean = (list: MonthOutcome[]) =>
    list.length ? list.reduce((s, m) => s + (scoreOf.get(m.category) ?? 0), 0) / list.length : null;

  if (total === 0) return [];

  const steps: number[] = [];
  for (let w = 3; w <= 12; w += 3) if (w <= total) steps.push(w); // quarters, year one
  for (let w = 18; w <= total; w += 6) steps.push(w); // half-years thereafter

  const out: RatingWindow[] = [];
  // All Time is its own point and is always shown: it is the baseline every other
  // point is being compared against.
  out.push({ months: null, label: "All Time", rating: mean(months) });
  for (const w of [...steps].reverse()) {
    // Skip a window that is simply the whole history under another name — two points
    // with the same value and different labels invite a comparison that is not there.
    if (w === total) continue;
    out.push({ months: w, label: `${w} Months`, rating: mean(months.slice(-w)) });
  }
  return out;
}
