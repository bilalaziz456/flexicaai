/**
 * What a clinic was charged, month by month — CORE, pure, client-safe.
 *
 * THE PROBLEM THIS SOLVES: `clinics.monthly_price` is a single number, so every
 * calculation that walked a clinic's history charged all of it at TODAY's price.
 * Raising a clinic from 5,000 to 8,000 turned six months of perfect payment into three
 * unpaid months and a 0.67 rating — a price rise reading as a payment collapse.
 *
 * A month is charged at the price in force ON ITS DUE DATE. So a rise takes effect from
 * the next month that falls due after it, and never re-invoices a month already billed.
 *
 * ONE schedule feeds BOTH `computeClinicBalance` and `computePaymentBehaviour`. That is
 * the point of putting it here rather than in either: the dues dashboard and the
 * scorecard disagreeing about whether March was paid would be a worse bug than either
 * being retrospectively wrong.
 */

export type PricePoint = {
  /** From this instant onward, until the next point. */
  from: Date;
  price: number;
};

/**
 * Build a usable schedule from stored rows.
 *
 * `fallback` covers the gap before the earliest recorded change — a clinic priced
 * before the history table existed, or one whose first row starts after billing did.
 * Without it those months would have no price and would silently be treated as free.
 */
export function buildPriceSchedule(
  rows: { price: number; effectiveFrom: Date }[],
  fallback: { from: Date; price: number },
): PricePoint[] {
  const points = rows
    .map((r) => ({ from: r.effectiveFrom, price: r.price }))
    .sort((a, b) => a.from.getTime() - b.from.getTime());

  if (points.length === 0 || points[0].from.getTime() > fallback.from.getTime()) {
    return [{ from: fallback.from, price: fallback.price }, ...points];
  }
  return points;
}

/** The price in force on a date. Before the schedule starts, the earliest price. */
export function priceOn(schedule: PricePoint[], at: Date): number {
  if (schedule.length === 0) return 0;
  let price = schedule[0].price;
  for (const p of schedule) {
    if (p.from.getTime() > at.getTime()) break;
    price = p.price;
  }
  return price;
}

/**
 * True when the schedule never changes price — the overwhelmingly common case.
 *
 * Callers use it to keep the single-price fast paths, so a clinic that has never been
 * re-priced behaves exactly as it did before this module existed.
 */
export function isFlat(schedule: PricePoint[]): boolean {
  return schedule.every((p) => p.price === schedule[0]?.price);
}

/**
 * What the clinic owes for the first `months` billed months, given a billing start.
 *
 * `monthAt` is passed in rather than recomputed here because two callers already own
 * the "add n months, clamping a 31st into a short month" rule, and a third copy of a
 * date-stepping function is how the three quietly disagree about February.
 */
export function accruedFor(
  schedule: PricePoint[],
  months: number,
  monthAt: (n: number) => Date,
): number {
  let total = 0;
  for (let n = 0; n < months; n++) total += priceOn(schedule, monthAt(n));
  return total;
}

/**
 * How many whole months a sum of money covers, walking them in order.
 *
 * Not `paid / price` — that only works when the price never moves. Walking is also what
 * makes a partial payment behave sensibly: the month it fails to complete is simply not
 * counted, exactly as the flat-price version did.
 */
export function monthsCoveredBy(
  schedule: PricePoint[],
  paid: number,
  monthAt: (n: number) => Date,
  maxMonths = 600,
): number {
  let remaining = paid;
  let n = 0;
  while (n < maxMonths) {
    const price = priceOn(schedule, monthAt(n));
    if (price <= 0 || remaining < price) break;
    remaining -= price;
    n++;
  }
  return n;
}
