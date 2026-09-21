/**
 * The dashboard sparklines AGREE WITH THE FIGURES THEY SIT UNDER.
 *
 * Two cards on `/clinic` carried a number and no shape, because no series existed for
 * either: "Payable to doctors" is a lifetime unpaid BALANCE and `getFinanceKpis`
 * computed no running payable, and "Net sales (30 days)" came from a flat aggregate
 * with no buckets at all. Both now have one — and the only thing that makes a
 * sparkline under a figure worth drawing is that the two cannot disagree.
 *
 * So this asserts the RELATIONSHIP, not the values:
 *
 *  - `payableTrend` must END at `payableToDoctors`. It is built by taking the lifetime
 *    balances as the anchor and subtracting each doctor's in-window movement to find
 *    their opening position, so the last point is the card's figure by construction
 *    (`getPayableTrend`). If someone later re-derives it from its own opening totals —
 *    a second copy of the balance formula, the thing ADR-015 exists to prevent — this
 *    is what goes red.
 *  - `salesSummary.trend` must SUM to `netTotal`, because both now come out of the same
 *    grouped rows. A series that sums to something other than the number above it is
 *    worse than no series.
 *  - Both must have one point per DAY of the window, so a quiet stretch reads as flat
 *    rather than being compressed out.
 *
 * Runs against whatever the database holds: no seeding, because the properties are
 * true of any data, and a test that only holds for rows it planted proves less.
 *
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-dashboard-trends.ts`
 */
import { isNull } from "drizzle-orm";
import { db } from "../src/core/db";
import { clinics } from "../src/core/db/schema";
import { getFinanceKpis } from "../src/core/finance/kpis";
import { getSalesSummary, resolveSalesRange } from "../src/core/sales/report";

let failures = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

/** Whole days spanned by the 30-day window, counted the way the builders step it. */
function dayCount(start: Date, end: Date): number {
  let n = 0;
  for (const c = new Date(start); c < end; c.setDate(c.getDate() + 1)) n++;
  return n;
}

async function main() {
  const rows = await db
    .select({ id: clinics.id, name: clinics.name })
    .from(clinics)
    .where(isNull(clinics.deletedAt));

  if (rows.length === 0) {
    console.log("No clinics in this database — nothing to check.");
    return;
  }

  const range = resolveSalesRange("30d", undefined, undefined);
  const days = dayCount(range.start, range.end);

  for (const clinic of rows) {
    console.log(`\n${clinic.name}`);

    const kpis = await getFinanceKpis(clinic.id);
    const last = kpis.payableTrend.at(-1);
    ok(
      "payable sparkline ends at the payable figure",
      last === kpis.payableToDoctors,
      `series ends ${last}, card shows ${kpis.payableToDoctors}`,
    );
    ok(
      "payable sparkline has one point per day",
      kpis.payableTrend.length === days,
      `${kpis.payableTrend.length} points for ${days} days`,
    );
    // A running balance of clamped per-doctor positions can never be negative; a
    // negative point would mean a doctor who OWES the clinic was allowed to reduce
    // what is owed to everyone else.
    ok(
      "payable sparkline never goes negative",
      kpis.payableTrend.every((v) => v >= 0),
      `min ${Math.min(...kpis.payableTrend)}`,
    );

    const sales = await getSalesSummary(clinic.id, range);
    const summed = sales.trend.reduce((a, v) => a + v, 0);
    ok(
      "net-sales sparkline sums to the net-sales figure",
      summed === sales.netTotal,
      `series sums to ${summed}, card shows ${sales.netTotal}`,
    );
    ok(
      "net-sales sparkline has one point per day",
      sales.trend.length === days,
      `${sales.trend.length} points for ${days} days`,
    );
  }

  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
