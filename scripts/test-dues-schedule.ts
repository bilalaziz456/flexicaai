/**
 * The DUES readers against a clinic whose price has moved (ADR-032).
 *
 * `scripts/test-price-schedule.ts` already proves the arithmetic: given a schedule,
 * `computeClinicBalance` charges each month at the price in force on its due date. That
 * was never the broken part. THE BUG WAS THE PLUMBING — three of the four readers never
 * passed a schedule, so the pure function faithfully re-priced a clinic's whole history
 * at today's figure and the dues dashboard showed a clinic that had paid every invoice
 * owing the difference for every month it had ever been billed. Nothing failed; the
 * number was simply wrong, and it drives who gets chased and the `past_due` lock.
 *
 * So these tests run the real DB readers, not the formula.
 *
 * THE CONTROL IS THE WHOLE DESIGN. A re-priced clinic (R) is seeded beside a clinic (C)
 * identical in every way except that its price never moved, and the assertion is that
 * their balances are EQUAL field for field. That holds whatever today's date is — no
 * month count to predict, no anniversary to dodge — and it is exactly what the bug
 * broke. Asserting "R owes 0" alone would pass just as well against a reader that
 * decided every clinic owes nothing, which is why F is here too: a clinic that genuinely
 * has not paid must still come out overdue and still appear on the dues list.
 *
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-dues-schedule.ts`
 */
import { inArray } from "drizzle-orm";
import { db } from "../src/core/db";
import { clinicPayments, clinicPriceChanges, clinics } from "../src/core/db/schema";
import {
  getClinicBalanceSummary,
  getClinicBilling,
  listDueClinics,
} from "../src/core/admin/billing";
import { getClinicAnalytics } from "../src/core/admin/clinic-analytics";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`);
  }
}

const TAG = `dues${Date.now()}`;
const ids: string[] = [];

const OLD_PRICE = 5000;
const NEW_PRICE = 8000;
const MONTHS_PAID = 6;

/**
 * Billing started five months and five days ago. The offset in DAYS matters: it keeps
 * every due date away from today, so a price change recorded NOW cannot land on a month
 * boundary and make the run depend on the date it happens to execute.
 */
const ACTIVATED = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() - 5);
  d.setDate(d.getDate() - 5);
  d.setHours(10, 0, 0, 0);
  return d;
})();

function monthAfterActivation(n: number): Date {
  const d = new Date(ACTIVATED);
  d.setMonth(d.getMonth() + n);
  return d;
}

async function makeClinic(
  name: string,
  opts: { monthlyPrice: number; payments: number; priceChanges?: { price: number; from: Date }[] },
): Promise<string> {
  const [row] = await db
    .insert(clinics)
    .values({
      name: `${TAG} ${name}`,
      modulesEnabled: ["dental"],
      monthlyPrice: opts.monthlyPrice,
      graceDays: 0,
      activatedAt: ACTIVATED,
      status: "active",
    })
    .returning({ id: clinics.id });
  ids.push(row.id);
  for (let n = 0; n < opts.payments; n++) {
    await db.insert(clinicPayments).values({
      clinicId: row.id,
      amount: OLD_PRICE,
      kind: "payment",
      occurredAt: monthAfterActivation(n),
    });
  }
  for (const c of opts.priceChanges ?? []) {
    await db.insert(clinicPriceChanges).values({
      clinicId: row.id,
      price: c.price,
      effectiveFrom: c.from,
    });
  }
  return row.id;
}

async function cleanup() {
  if (!ids.length) return;
  await db.delete(clinicPayments).where(inArray(clinicPayments.clinicId, ids));
  await db.delete(clinicPriceChanges).where(inArray(clinicPriceChanges.clinicId, ids));
  await db.delete(clinics).where(inArray(clinics.id, ids));
  console.log("\nseeded rows removed");
}

/** The fields a human actually reads off the dues screens. */
function figures(b: {
  accrued: number;
  owed: number;
  credit: number;
  monthsPaid: number;
  billingStatus: string;
}) {
  return {
    accrued: b.accrued,
    owed: b.owed,
    credit: b.credit,
    monthsPaid: b.monthsPaid,
    billingStatus: b.billingStatus,
  };
}

async function main() {
  // R: raised to 8,000 TODAY, having paid all six billed months at 5,000.
  const repriced = await makeClinic("repriced", {
    monthlyPrice: NEW_PRICE,
    payments: MONTHS_PAID,
    priceChanges: [
      { price: OLD_PRICE, from: ACTIVATED },
      { price: NEW_PRICE, from: new Date() },
    ],
  });
  // C: the control — same history, price never moved.
  const control = await makeClinic("control", { monthlyPrice: OLD_PRICE, payments: MONTHS_PAID });
  // F: genuinely behind — two months paid of the same six.
  const behind = await makeClinic("behind", { monthlyPrice: OLD_PRICE, payments: 2 });

  const [r, c, f] = await Promise.all([
    getClinicBilling(repriced),
    getClinicBilling(control),
    getClinicBilling(behind),
  ]);

  console.log("The clinic billing card prices each month at what it cost THEN:");
  check("a price rise today leaves the paid history alone", figures(r!.balance), figures(c!.balance));
  check("…so the clinic owes nothing", r!.balance.owed, 0);
  check("…and is not overdue", r!.balance.billingStatus, "active");
  check("the rise still shows as the current price", r!.clinic.monthlyPrice, NEW_PRICE);

  console.log("\nAnd a clinic that really has not paid is still behind:");
  // Same activation, so the same months are billed and `accrued` must match R's exactly
  // — which lets the shortfall be asserted without predicting the month count.
  check("billed the same months as the others", f!.balance.accrued, r!.balance.accrued);
  check("owing everything it has not paid", f!.balance.owed, r!.balance.accrued - 2 * OLD_PRICE);
  check("…and reading as overdue", f!.balance.billingStatus, "overdue");

  console.log("\nThe workspace's payment pill reads the same balance as the card:");
  // Deliberately WITHOUT a schedule — `src/app/clinic/layout.tsx` hands this a bare
  // clinic row from `getClinic`, so passing the enriched one from the card above would
  // test the caller-supplied shortcut and leave the path the app actually takes
  // unexercised. (It did, for one run: dropping the schedule inside the summary changed
  // nothing until this was fixed.)
  const bare = (x: NonNullable<typeof r>) => ({
    id: x.clinic.id,
    monthlyPrice: x.clinic.monthlyPrice,
    graceDays: x.clinic.graceDays,
    activatedAt: x.clinic.activatedAt,
    createdAt: x.clinic.createdAt,
  });
  const [summaryR, summaryF] = await Promise.all([
    getClinicBalanceSummary(bare(r!)),
    getClinicBalanceSummary(bare(f!)),
  ]);
  check("re-priced clinic: no pill-worthy balance", figures(summaryR), figures(r!.balance));
  check("clinic behind: the same shortfall", figures(summaryF), figures(f!.balance));

  console.log("\nThe dues dashboard lists the clinic that owes, and only that one:");
  const due = await listDueClinics({ includeUpcoming: true });
  const seeded = new Set(ids);
  const listed = due.filter((x) => seeded.has(x.id)).map((x) => ({ id: x.id, alert: x.alert }));
  check("only the clinic genuinely behind is flagged", listed, [{ id: behind, alert: "overdue" }]);
  const listedBehind = due.find((x) => x.id === behind)!;
  check("with the same figure the card shows", listedBehind.balance.owed, f!.balance.owed);

  console.log("\nAnd the scorecard cannot disagree with the dues screens:");
  for (const [label, id, card] of [
    ["re-priced", repriced, r!],
    ["behind", behind, f!],
  ] as const) {
    const a = await getClinicAnalytics(id, { months: null });
    check(`${label}: analytics balance matches the billing card`, figures(a!.balance), figures(card.balance));
  }
}

main()
  .then(cleanup)
  .then(() => {
    console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    await cleanup().catch(() => {});
    console.error(e);
    process.exit(1);
  });
