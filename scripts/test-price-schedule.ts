/**
 * Price history (`core/admin/price-schedule.ts`) and the two calculators that read it.
 *
 * TWO THINGS TO PROVE, and the first matters more than the second:
 *
 * 1. A clinic whose price has NEVER moved must behave exactly as it did before this
 *    existed. This is money — `computeClinicBalance` drives the dues dashboard, the
 *    overdue sweep and the status lock — so the safe change is the one that is provably
 *    inert for every clinic that is not affected.
 * 2. A clinic whose price HAS moved must keep the months it already paid. That was the
 *    bug: raising a clinic from 5,000 to 8,000 turned six perfect months into three
 *    unpaid ones and a 0.67 rating, because every month was re-priced at today's figure.
 *
 * Run: `tsx --tsconfig scripts/_seed/tsconfig.json scripts/test-price-schedule.ts`
 */
import { computeClinicBalance } from "../src/core/admin/billing";
import { computePaymentBehaviour } from "../src/core/admin/payment-behaviour";
import { buildPriceSchedule, priceOn } from "../src/core/admin/price-schedule";

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
const START = d("2026-01-01");
const base = { monthlyPrice: 5000, activatedAt: START, createdAt: START, graceDays: 0 };
const pay = (on: string, amount: number) => ({ amount, kind: "payment", occurredAt: d(on) });
const sixMonths = Array.from({ length: 6 }, (_, i) =>
  pay(`2026-${String(i + 1).padStart(2, "0")}-01`, 5000),
);

console.log("Building a schedule:");
{
  const rows = [
    { price: 8000, effectiveFrom: d("2026-07-01") },
    { price: 5000, effectiveFrom: d("2026-01-01") },
  ];
  const sched = buildPriceSchedule(rows, { from: START, price: 8000 });
  // Sorted, and NOT prefixed with the fallback: the earliest row already covers the
  // billing start, so prepending today's price would rewrite January.
  check("sorted oldest first", sched.map((p) => p.price), [5000, 8000]);
  check("no spurious fallback point", sched.length, 2);

  // A clinic priced before the table existed has rows that begin AFTER billing did.
  const late = buildPriceSchedule([{ price: 9000, effectiveFrom: d("2026-06-01") }], {
    from: START,
    price: 5000,
  });
  check("a gap before the first row is filled", late.map((p) => p.price), [5000, 9000]);
  // Without that, January–May would have no price at all and would read as free.
  check("…so early months are still priced", priceOn(late, d("2026-02-01")), 5000);

  check("empty schedule prices nothing", priceOn([], d("2026-02-01")), 0);
}

console.log("\nA price applies from the month that falls due after it:");
{
  const sched = buildPriceSchedule(
    [
      { price: 5000, effectiveFrom: START },
      { price: 8000, effectiveFrom: d("2026-07-15") },
    ],
    { from: START, price: 8000 },
  );
  check("June, before the rise", priceOn(sched, d("2026-06-01")), 5000);
  // The rise lands mid-July, AFTER July's invoice fell due on the 1st.
  check("July, already billed when the rise landed", priceOn(sched, d("2026-07-01")), 5000);
  check("August, the first month after it", priceOn(sched, d("2026-08-01")), 8000);
}

console.log("\nA clinic that has never been re-priced is untouched:");
{
  const now = d("2026-06-15");
  const flat = computeClinicBalance(base, sixMonths, now);
  // The same clinic, with its (unchanged) price recorded as history.
  const recorded = computeClinicBalance(
    { ...base, priceSchedule: [{ from: START, price: 5000 }] },
    sixMonths,
    now,
  );
  check("balance is identical, field for field", recorded, flat);

  const bFlat = computePaymentBehaviour(base, sixMonths, now);
  const bRec = computePaymentBehaviour(
    { ...base, priceSchedule: [{ from: START, price: 5000 }] },
    sixMonths,
    now,
  );
  check("rating is identical", bRec.rating, bFlat.rating);
  check("categories are identical", bRec.counts, bFlat.counts);
  check("…and it is a perfect record", [bFlat.rating, bFlat.unpaidMonths], [4, 0]);
}

console.log("\nTHE BUG: raising the price must not rewrite what was paid:");
{
  const now = d("2026-06-15");
  // Six months paid in full at 5,000. The clinic is then moved to 8,000.
  const raisedNoHistory = computePaymentBehaviour({ ...base, monthlyPrice: 8000 }, sixMonths, now);
  check("without history, six perfect months become unpaid", raisedNoHistory.unpaidMonths, 3);
  check("…and the rating collapses", Number(raisedNoHistory.rating?.toFixed(2)), 0.67);

  const sched = buildPriceSchedule(
    [
      { price: 5000, effectiveFrom: START },
      { price: 8000, effectiveFrom: d("2026-06-20") },
    ],
    { from: START, price: 8000 },
  );
  const raised = computePaymentBehaviour(
    { ...base, monthlyPrice: 8000, priceSchedule: sched },
    sixMonths,
    now,
  );
  check("with history, nothing is unpaid", raised.unpaidMonths, 0);
  check("…and the rating is intact", raised.rating, 4);
  check("…and each month keeps the amount it was billed", raised.months.map((m) => m.amount), [
    5000, 5000, 5000, 5000, 5000, 5000,
  ]);

  // And the balance agrees — the two must never disagree about what was owed.
  const bal = computeClinicBalance(
    { ...base, monthlyPrice: 8000, priceSchedule: sched },
    sixMonths,
    now,
  );
  check("the balance owes nothing either", bal.owed, 0);
  check("accrued is six months at 5,000", bal.accrued, 30000);
}

console.log("\nThe NEXT month is charged at the new price:");
{
  const sched = buildPriceSchedule(
    [
      { price: 5000, effectiveFrom: START },
      { price: 8000, effectiveFrom: d("2026-06-20") },
    ],
    { from: START, price: 8000 },
  );
  const now = d("2026-07-10");
  const b = computePaymentBehaviour(
    { ...base, monthlyPrice: 8000, priceSchedule: sched },
    sixMonths,
    now,
  );
  check("seven months billed", b.months.length, 7);
  check("July is billed at the new price", b.months[6].amount, 8000);
  check("…and is unpaid", b.unpaidMonths, 1);

  const bal = computeClinicBalance(
    { ...base, monthlyPrice: 8000, priceSchedule: sched },
    sixMonths,
    now,
  );
  // 6 × 5,000 + 1 × 8,000 = 38,000 accrued, 30,000 paid.
  check("accrued mixes the two prices", bal.accrued, 38000);
  check("owed is the new month only", bal.owed, 8000);
  check("six months are covered", bal.monthsPaid, 6);
}

console.log("\nA price CUT works the same way round:");
{
  const sched = buildPriceSchedule(
    [
      { price: 10000, effectiveFrom: START },
      { price: 4000, effectiveFrom: d("2026-03-20") },
    ],
    { from: START, price: 4000 },
  );
  const paid = [pay("2026-01-01", 10000), pay("2026-02-01", 10000), pay("2026-03-01", 10000)];
  const b = computePaymentBehaviour(
    { ...base, monthlyPrice: 4000, priceSchedule: sched },
    paid,
    d("2026-04-10"),
  );
  check("April is billed at the lower price", b.months[3].amount, 4000);
  // 30,000 paid covers three months at 10,000 with nothing left; April is unpaid.
  check("the three dear months stay settled", b.months.slice(0, 3).every((m) => m.settledAt !== null), true);
  check("April is not", b.months[3].settledAt, null);
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
