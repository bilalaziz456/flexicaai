import {
  PAYER_CATEGORIES,
  PENDING,
  type MonthStatus,
  type PayerCategory,
  categoryFor,
} from "@/core/admin/payer-categories";

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
 *
 * KNOWN LIMITATION — A PRICE CHANGE REWRITES HISTORY. `needed` is `(n + 1) × the
 * CURRENT monthly price`, because the schema keeps no price history: nothing records
 * what a clinic was charged in March. Raising a clinic from 5,000 to 8,000 therefore
 * makes six months of perfect payment read as three unpaid months and a 0.67 rating.
 *
 * It is left this way on purpose. `computeClinicBalance` makes exactly the same
 * assumption, so the scorecard and the dues dashboard agree about which months are
 * paid — and the two of them disagreeing about that would be a worse bug than either
 * being retrospectively wrong. `clinic_payments.months_covered` would fix it for
 * payments that carry it, but using it here and not there is precisely the divergence
 * to avoid. The fix, if it becomes worth it, is a price-history table feeding BOTH.
 */

export type MonthOutcome = {
  /** First day of the month being paid for. */
  period: Date;
  dueAt: Date;
  /** When the running total first covered this month, or null if it never did. */
  settledAt: Date | null;
  /** Negative = paid early. Null when never settled. */
  daysLate: number | null;
  /** One of the six graded bands, or `pending` — unpaid but not yet late. */
  category: MonthStatus;
  amount: number;
};

export type PaymentBehaviour = {
  months: MonthOutcome[];
  /** 0–5, the mean of each month's category score. Null when there is no history. */
  rating: number | null;
  /** Share of months settled on or before the due date. Null when no history. */
  onTimeRate: number | null;
  counts: Record<PayerCategory, number>;
  /** Months excluded from the rating because they are not yet late. */
  pending: number;
  /** Months genuinely late or unpaid past grace. Excludes `pending`. */
  unpaidMonths: number;
  current: MonthStatus | null;
};

export type WindowSummary = {
  /** GRADED months in the window — the denominator for the rating. */
  total: number;
  /** Months in the window that were skipped because they are not yet late. */
  pending: number;
  rating: number | null;
  onTimeRate: number | null;
  counts: Record<PayerCategory, number>;
};

/**
 * Rating, on-time rate and category share over ANY slice of months.
 *
 * Extracted so the card can re-scope to a selected window in the browser instead of
 * asking the server again: the months are already on the client, and a round trip to
 * re-count six of them would make the period buttons feel like navigation.
 *
 * Pure, and the same function the full-history summary uses — so "last 6 months" and
 * "all time" cannot be computed two different ways.
 */
export function summariseWindow(months: MonthOutcome[]): WindowSummary {
  const counts = Object.fromEntries(PAYER_CATEGORIES.map((c) => [c.code, 0])) as Record<
    PayerCategory,
    number
  >;
  // A month still inside its grace period is not graded — see PENDING. Every figure
  // below is over the GRADED months only, so an invoice that fell due this morning
  // cannot move a rating built from a year of history.
  const graded = months.filter((m) => m.category !== PENDING);
  for (const m of graded) counts[m.category as PayerCategory]++;
  const pending = months.length - graded.length;
  if (graded.length === 0) return { total: 0, pending, rating: null, onTimeRate: null, counts };

  const scoreOf = new Map(PAYER_CATEGORIES.map((c) => [c.code, c.score]));
  const rating = graded.reduce((s, m) => s + (scoreOf.get(m.category as PayerCategory) ?? 0), 0) / graded.length;
  const onTime = graded.filter((m) => m.daysLate !== null && m.daysLate <= 0).length;
  return { total: graded.length, pending, rating, onTimeRate: onTime / graded.length, counts };
}

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
  clinic: { monthlyPrice: number; activatedAt: Date | null; createdAt: Date; graceDays?: number },
  payments: { amount: number; kind?: string; occurredAt: Date }[],
  now: Date = new Date(),
): PaymentBehaviour {
  const empty: PaymentBehaviour = {
    months: [],
    rating: null,
    onTimeRate: null,
    counts: Object.fromEntries(PAYER_CATEGORIES.map((c) => [c.code, 0])) as Record<PayerCategory, number>,
    pending: 0,
    unpaidMonths: 0,
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
      category: categoryFor(daysLate, dueAt, now, clinic.graceDays ?? 0),
      amount: price,
    });
  }

  if (months.length === 0) return empty;

  const { rating, onTimeRate, counts, pending } = summariseWindow(months);
  // Genuinely unpaid, i.e. past grace. `unpaidAmount` used to sit here as
  // count × price, which OVERSTATED a partly-paid month — 4,000 of 5,000 reported
  // 5,000 outstanding. The real figure is `balance.owed`, which the card already
  // shows, so the wrong one is gone rather than fixed in a second place.
  const unpaid = months.filter((m) => m.settledAt === null && m.category !== PENDING);

  return {
    months,
    rating,
    onTimeRate,
    counts,
    pending,
    unpaidMonths: unpaid.length,
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
  // Pending months carry no score, so including them would drag every mean toward
  // zero — the bug this whole change removes, reappearing in the trend.
  const mean = (list: MonthOutcome[]) => {
    const graded = list.filter((m) => m.category !== PENDING);
    return graded.length
      ? graded.reduce((s, m) => s + (scoreOf.get(m.category as PayerCategory) ?? 0), 0) / graded.length
      : null;
  };

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
 * Only windows the HISTORY can fill are generated: the "36 Months" tick on a 14-month
 * clinic is not a low bar, it is absent. Within a window that does exist, the mean is
 * over its GRADEABLE months, so a "12 Months" point on a clinic whose newest invoice is
 * still inside its grace period is the mean of eleven — the label names the span, not
 * the sample size. A window with nothing gradeable at all rates `null` and the chart
 * draws no marker for it, rather than placing one at zero.
 *
 * Ordered widest-first (All Time on the left, 3 Months on the right) so the line reads
 * past → present and a decline slopes downward, the way the eye expects.
 */
export function ratingWindows(months: MonthOutcome[]): RatingWindow[] {
  const total = months.length;
  const scoreOf = new Map(PAYER_CATEGORIES.map((c) => [c.code, c.score]));
  const mean = (list: MonthOutcome[]) => {
    const graded = list.filter((m) => m.category !== PENDING);
    return graded.length
      ? graded.reduce((s, m) => s + (scoreOf.get(m.category as PayerCategory) ?? 0), 0) / graded.length
      : null;
  };

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
