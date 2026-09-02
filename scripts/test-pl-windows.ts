/**
 * DIFFERENTIAL TEST — the dashboard's two P&L windows, computed in ONE pass.
 *
 * `getFinanceKpis` used to call `getProfitAndLoss` twice: once for the last 30 days
 * and once for the 30 before that, purely to get four scalars for the "vs previous"
 * deltas. That was a second complete set of aggregations for eight numbers. It now
 * makes one call with `{ comparedTo }`, which widens the scan across both windows and
 * tags each grouped row with the window it belongs to.
 *
 * What that could break is subtle, so this asserts it directly:
 *   1. the comparison totals equal what a separate call for the prior range returns;
 *   2. the CURRENT window's figures are unchanged by asking for a comparison at all —
 *      i.e. widening the scan leaks nothing forward;
 *   3. nothing leaks into the chart BUCKETS, tested at MONTH granularity where a
 *      prior-window day and a current-window day genuinely share a bucket;
 *   4. summing the expense rows equals the `expensesTotal` query it replaced.
 *
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-pl-windows.ts`
 */
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import {
  appointments,
  clinics,
  discountSettlements,
  doctorSettlementActions,
  expenses,
  patients,
  sales,
  saleShares,
  users,
} from "@/core/db/schema";
import { unscoped } from "@/core/db/tenant-guard";
import { getProfitAndLoss } from "@/core/finance/pl";
import { expensesTotal } from "@/core/expenses";
import type { ResolvedRange } from "@/core/sales/report";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
  }
}

const uniq = Date.now();
const TAG = `plw${uniq}`;
let clinicId = "";
let doctorId = "";
let patientId = "";

/** Local midnight, `daysAgo` back from today. */
function midnight(daysAgo: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d;
}
/** A timestamp inside the day `daysAgo` back. */
function at(daysAgo: number, hour = 12): Date {
  const d = midnight(daysAgo);
  d.setHours(hour, 30, 0, 0);
  return d;
}
const iso = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** A range over [daysAgo(from), daysAgo(to)) — mirrors what `resolveSalesRange` returns. */
function range(fromDaysAgo: number, toDaysAgo: number, granularity: "day" | "month"): ResolvedRange {
  const start = midnight(fromDaysAgo);
  const end = midnight(toDaysAgo);
  return { period: "custom", start, end, granularity, from: iso(start), to: iso(end) };
}

async function seed() {
  [{ id: clinicId }] = await db
    .insert(clinics)
    .values({ name: `${TAG} clinic`, modulesEnabled: ["dental"] })
    .returning({ id: clinics.id });
  [{ id: doctorId }] = await db
    .insert(users)
    .values({ clinicId, username: `${TAG}_doc`, passwordHash: "x", role: "doctor", fullName: "PLW Doctor", consultationFee: 2000 })
    .returning({ id: users.id });
  [{ id: patientId }] = await db
    .insert(patients)
    .values({ clinicId, fullName: `${TAG} Patient` })
    .returning({ id: patients.id });
}

/** One appointment + its sale / share / settlement / action / expense on a given day. */
async function activity(daysAgo: number, amount: number) {
  const [appt] = await db
    .insert(appointments)
    .values({ clinicId, patientId, doctorId, scheduledAt: at(daysAgo), status: "completed" })
    .returning({ id: appointments.id });
  await db.insert(sales).values({
    clinicId, appointmentId: appt.id, doctorId, doctorName: "PLW Doctor",
    grossAmount: amount, discountAmount: 0, netAmount: amount, occurredAt: at(daysAgo),
  });
  await db.insert(saleShares).values({
    clinicId, appointmentId: appt.id, doctorId, doctorName: "PLW Doctor",
    shareAmount: Math.round(amount / 10), occurredAt: at(daysAgo),
  });
  await db.insert(discountSettlements).values({
    clinicId, appointmentId: appt.id, party: "doctor", doctorId, doctorName: "PLW Doctor",
    grossShare: amount, settlementAmount: 7, occurredAt: at(daysAgo),
  });
  // A clinic waive is a COST; a doctor waive a SAVING. Seeding both proves the sign
  // handling survives partitioning, not just the sum.
  await db.insert(doctorSettlementActions).values({
    clinicId, doctorId, doctorName: "PLW Doctor", appointmentId: appt.id,
    kind: "clinic_waive", amount: 30, occurredAt: at(daysAgo),
  });
  await db.insert(doctorSettlementActions).values({
    clinicId, doctorId, doctorName: "PLW Doctor", appointmentId: appt.id,
    kind: "doctor_waive", amount: 10, occurredAt: at(daysAgo),
  });
  await db.insert(expenses).values({
    clinicId, amount: Math.round(amount / 4), incurredOn: iso(midnight(daysAgo)), method: "cash",
  });
}

async function cleanup() {
  await unscoped("test teardown", async () => {
    await db.delete(doctorSettlementActions).where(eq(doctorSettlementActions.clinicId, clinicId));
    await db.delete(discountSettlements).where(eq(discountSettlements.clinicId, clinicId));
    await db.delete(saleShares).where(eq(saleShares.clinicId, clinicId));
    await db.delete(sales).where(eq(sales.clinicId, clinicId));
    await db.delete(expenses).where(eq(expenses.clinicId, clinicId));
    await db.delete(appointments).where(eq(appointments.clinicId, clinicId));
    await db.delete(patients).where(eq(patients.clinicId, clinicId));
    await db.delete(users).where(eq(users.clinicId, clinicId));
    await db.delete(clinics).where(eq(clinics.id, clinicId));
  });
}

const scalars = (p: { revenue: number; doctorShares: number; expenses: number; netProfit: number }) => ({
  revenue: p.revenue, doctorShares: p.doctorShares, expenses: p.expenses, netProfit: p.netProfit,
});

async function main() {
  await seed();

  // Current window = the last 10 days; prior = the 10 before it. Different amounts on
  // each side, so anything leaking across shows up as a wrong number rather than a
  // coincidentally equal one.
  for (const d of [1, 3, 6, 9]) await activity(d, 1000 * d);
  for (const d of [11, 14, 17, 19]) await activity(d, 77 * d);

  const current = range(10, 0, "day");
  const prior = range(20, 10, "day");

  console.log("The comparison window equals a separate call for that range:");
  const one = await getProfitAndLoss(clinicId, current, { comparedTo: prior });
  const separate = await getProfitAndLoss(clinicId, prior);
  check("prior totals match", one.comparison, scalars(separate));
  check("…and are non-zero (the seed actually reached that window)", (one.comparison?.revenue ?? 0) > 0, true);

  console.log("\nAsking for a comparison does not change the CURRENT window:");
  const alone = await getProfitAndLoss(clinicId, current);
  check("totals identical", scalars(one), scalars(alone));
  check("revenue buckets identical", one.revenueBuckets, alone.revenueBuckets);
  check("p&l buckets identical", one.plBuckets, alone.plBuckets);
  check("by-category identical", one.byExpenseCategory, alone.byExpenseCategory);
  check("by-doctor identical", one.byDoctor, alone.byDoctor);
  check("no comparison key when not asked for", alone.comparison, undefined);
  check("the two windows really differ", one.revenue === one.comparison?.revenue, false);

  console.log("\nMONTH granularity — where a prior day and a current day share a bucket:");
  {
    // Both windows inside one calendar month, so `startOfBucket` maps every day in
    // BOTH to the same month bucket. Partitioning by row is the only thing stopping
    // the prior window's revenue being added to the current month's bar.
    const cur = range(6, 0, "month");
    const pre = range(12, 6, "month");
    const both = await getProfitAndLoss(clinicId, cur, { comparedTo: pre });
    const solo = await getProfitAndLoss(clinicId, cur);
    check("buckets unaffected by the widened scan", both.plBuckets, solo.plBuckets);
    check("current totals unaffected", scalars(both), scalars(solo));
    check("…and the comparison still matches its own call", both.comparison, scalars(await getProfitAndLoss(clinicId, pre)));
  }

  console.log("\nExpenses summed from the grouped rows equal the query they replaced:");
  {
    const p = await getProfitAndLoss(clinicId, current, { comparedTo: prior });
    check("current window", p.expenses, await expensesTotal(clinicId, current.start, current.end));
    check("prior window", p.comparison?.expenses, await expensesTotal(clinicId, prior.start, prior.end));
    check("…and both are non-zero", p.expenses > 0 && (p.comparison?.expenses ?? 0) > 0, true);
  }

  console.log("\nA window with no activity totals zero rather than borrowing from its neighbour:");
  {
    const empty = range(400, 390, "day");
    const p = await getProfitAndLoss(clinicId, current, { comparedTo: empty });
    check("empty comparison is all zeroes", p.comparison, { revenue: 0, doctorShares: 0, expenses: 0, netProfit: 0 });
    check("…and the current window is still right", scalars(p), scalars(alone));
  }

  await cleanup();
  console.log("\nseeded rows removed");
}

main()
  .catch(async (e) => {
    failures++;
    console.error(e);
    try { await cleanup(); } catch { /* teardown is best-effort on a failed run */ }
  })
  .finally(() => {
    console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
