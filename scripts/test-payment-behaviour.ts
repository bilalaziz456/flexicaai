/**
 * The subscription payment scorecard (`core/admin/payment-behaviour.ts`).
 *
 * WHY THIS IS TESTED AND NOT JUST EYEBALLED: the card grades a paying customer and the
 * owner acts on that grade — chasing, offering a plan, or starting a churn
 * conversation. A category boundary that is off by a day, or a rating computed from
 * fewer months than its label claims, produces a confident wrong judgement about a
 * real relationship. Every check below is a case where the honest answer differs from
 * the convenient one.
 *
 * Pure module, no DB. Run:
 *   `tsx --tsconfig scripts/_seed/tsconfig.json scripts/test-payment-behaviour.ts`
 */
import {
  computePaymentBehaviour,
  computeTrend,
  ratingWindows,
} from "../src/core/admin/payment-behaviour";
import { categoryFor, gradeFor, riskFor } from "../src/core/admin/payer-categories";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`);
  }
}

const d = (s: string) => new Date(`${s}T10:00:00`);
/** Billing starts 1 Jan; each month is due on the 1st. */
const CLINIC = { monthlyPrice: 5000, activatedAt: d("2026-01-01"), createdAt: d("2025-12-01") };
const pay = (on: string, amount = 5000, kind = "payment") => ({
  amount,
  kind,
  occurredAt: d(on),
});

console.log("Category boundaries:");
{
  const due = d("2026-03-01");
  const now = d("2026-06-01");
  check("2 days early → early", categoryFor(-2, due, now), "early");
  check("on the day → on_time", categoryFor(0, due, now), "on_time");
  check("1 day late → delayed", categoryFor(1, due, now), "delayed");
  check("5 days late → delayed", categoryFor(5, due, now), "delayed");
  check("6 days late → overdue", categoryFor(6, due, now), "overdue");
  check("10 days late → overdue", categoryFor(10, due, now), "overdue");
  check("11 days late → defaulter", categoryFor(11, due, now), "defaulter");

  // An unpaid month is NOT automatically the worst band. A month that fell due
  // yesterday is simply not paid yet, and grading it "outstanding" would drop a good
  // clinic's rating the morning its invoice landed.
  check(
    "unpaid, still inside its due month → defaulter",
    categoryFor(null, d("2026-06-01"), d("2026-06-15")),
    "defaulter",
  );
  check(
    "unpaid once the month has passed → outstanding",
    categoryFor(null, d("2026-06-01"), d("2026-07-02")),
    "outstanding",
  );
}

console.log("\nA clinic that always pays on the day:");
{
  const b = computePaymentBehaviour(
    CLINIC,
    [pay("2026-01-01"), pay("2026-02-01"), pay("2026-03-01")],
    d("2026-03-15"),
  );
  check("three months billed", b.months.length, 3);
  check("all on time", b.counts.on_time, 3);
  check("rating is 4/5", b.rating, 4);
  check("on-time rate 100%", b.onTimeRate, 1);
  check("nothing unpaid", [b.unpaidMonths, b.unpaidAmount], [0, 0]);
  check("grade is good", gradeFor(b.rating), "good");
  check("no risk", riskFor(b.current, b.unpaidMonths).label, "No risk");
}

console.log("\nPaying ahead:");
{
  // One payment covering three months, made on day one.
  const b = computePaymentBehaviour(CLINIC, [pay("2026-01-01", 15000)], d("2026-03-15"));
  check("three months covered by one payment", b.months.length, 3);
  check("month 1 is on time", b.months[0].category, "on_time");
  // Months 2 and 3 were already covered when they fell due — that is early, and
  // crediting them as merely on-time would under-rate the best-behaved clinic there is.
  check("months 2 and 3 are early", [b.months[1].category, b.months[2].category], ["early", "early"]);
  check("nothing owed", b.unpaidMonths, 0);
}

console.log("\nA clinic that has stopped paying:");
{
  const b = computePaymentBehaviour(
    CLINIC,
    [pay("2026-01-01"), pay("2026-02-01")],
    d("2026-05-20"),
  );
  check("five months billed", b.months.length, 5);
  check("two settled, three not", b.months.filter((m) => m.settledAt !== null).length, 2);
  check("unpaid months counted", b.unpaidMonths, 3);
  check("unpaid amount is 3 × price", b.unpaidAmount, 15000);
  // March and April are gone; May is still inside its month.
  check("March is outstanding", b.months[2].category, "outstanding");
  check("May is not yet outstanding", b.months[4].category, "defaulter");
  check("risk is critical", riskFor(b.current, b.unpaidMonths).label, "Critical risk");
}

console.log("\nA refund takes the money back out:");
{
  // Paid for two months, then one was refunded — the second month must stop counting
  // as settled, or a refunded clinic reads as paid up.
  const withRefund = computePaymentBehaviour(
    CLINIC,
    [pay("2026-01-01"), pay("2026-02-01"), pay("2026-02-20", 5000, "refund")],
    d("2026-02-25"),
  );
  check("only one month stays settled", withRefund.months.filter((m) => m.settledAt).length, 1);
  check("one month unpaid", withRefund.unpaidMonths, 1);
}

console.log("\nPartial payments:");
{
  // Half a month twice — the month is settled when the running total first covers it,
  // which is the SECOND payment, not the first.
  const b = computePaymentBehaviour(
    CLINIC,
    [pay("2026-01-01", 2500), pay("2026-01-09", 2500)],
    d("2026-01-20"),
  );
  check("settled by the payment that completed it", b.months[0].daysLate, 8);
  check("…which lands in the overdue band", b.months[0].category, "overdue");
}

console.log("\nTime of day never costs a clinic a day:");
{
  const b = computePaymentBehaviour(
    CLINIC,
    [{ amount: 5000, kind: "payment", occurredAt: new Date("2026-01-01T23:55:00") }],
    d("2026-01-20"),
  );
  check("a payment at 23:55 on the due date is on time", b.months[0].category, "on_time");
}

console.log("\nNo history to grade:");
{
  const free = computePaymentBehaviour(
    { ...CLINIC, monthlyPrice: 0 },
    [],
    d("2026-06-01"),
  );
  // A clinic on no price is never billed — distinct from one billed and unpaid, which
  // is why it returns nothing rather than a zero rating.
  check("a free clinic has no months and no rating", [free.months.length, free.rating], [0, null]);

  const future = computePaymentBehaviour(
    { ...CLINIC, activatedAt: d("2027-01-01") },
    [],
    d("2026-06-01"),
  );
  check("billing that has not started yet rates nothing", future.rating, null);
  check("no grade from a null rating", gradeFor(null), null);
}

console.log("\nTrend — the number the dues list cannot show:");
{
  const months = (cats: number) =>
    computePaymentBehaviour(
      CLINIC,
      Array.from({ length: cats }, (_, i) => pay(`2026-${String(i + 1).padStart(2, "0")}-01`)),
      d(`2026-${String(cats).padStart(2, "0")}-15`),
    ).months;

  // Three months of history cannot be compared against itself; reporting "stable"
  // there would be a statement about arithmetic, not about the clinic.
  check("too little history → unknown", computeTrend(months(3)).direction, "unknown");

  const long = computePaymentBehaviour(
    CLINIC,
    // Nine months paid on the day, then three paid 20 days late.
    [
      ...Array.from({ length: 9 }, (_, i) => pay(`2026-${String(i + 1).padStart(2, "0")}-01`)),
      pay("2026-10-21"),
      pay("2026-11-21"),
      pay("2026-12-21"),
    ],
    d("2026-12-28"),
  );
  check("twelve months billed", long.months.length, 12);
  check("a clinic that has started slipping reads declining", computeTrend(long.months).direction, "declining");
}

console.log("\nWindows adapt to the length of the relationship:");
{
  const history = (n: number) =>
    computePaymentBehaviour(
      { monthlyPrice: 5000, activatedAt: new Date(2020, 0, 1, 10), createdAt: new Date(2020, 0, 1, 10) },
      Array.from({ length: n }, (_, i) => ({
        amount: 5000,
        kind: "payment",
        occurredAt: new Date(2020, i, 1, 10),
      })),
      new Date(2020, n - 1, 15, 10),
    ).months;

  const labels = (n: number) => ratingWindows(history(n)).map((w) => w.label);

  // Under a year the step is a QUARTER: a 6/12/18 ladder would give an eight-month
  // clinic a single point to look at.
  check("8 months → quarters only", labels(8), ["All Time", "6 Months", "3 Months"]);
  check("12 months → the full first-year ladder", labels(12), [
    "All Time", "9 Months", "6 Months", "3 Months",
  ]);

  // Past a year the step becomes a HALF-YEAR — a clinic three years in does not need
  // eleven near-identical points, and the eye cannot read them anyway.
  check("20 months → half-years appear", labels(20), [
    "All Time", "18 Months", "12 Months", "9 Months", "6 Months", "3 Months",
  ]);
  check("36 months → sixes, never 15/21/27", labels(36), [
    "All Time", "30 Months", "24 Months", "18 Months", "12 Months", "9 Months", "6 Months", "3 Months",
  ]);

  const w20 = ratingWindows(history(20));
  // Every point on the chart must be real. A window longer than the history is
  // ABSENT, not drawn low — that was the old bug wearing a new label.
  check("no window exceeds the history", w20.every((w) => w.months === null || w.months <= 20), true);
  check("every point has a rating", w20.every((w) => w.rating !== null), true);
  // At exactly 12 months, "12 Months" and "All Time" are one number under two labels,
  // which invites a comparison that does not exist.
  check("a window equal to the history is dropped", labels(12).includes("12 Months"), false);
  check("All Time leads, so the line reads past → present", labels(20)[0], "All Time");
  check("no history → no series", ratingWindows([]).length, 0);
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
