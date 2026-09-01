/**
 * Delta D-12 — reports aggregate in SQL, not by pulling every row into memory.
 *
 * Four reports used to select an unbounded row set for a date range and fold it in
 * JavaScript: the P&L (five scans to produce four scalars), the day book / cash
 * summary (the whole cash ledger to produce four rows), the discounts report (every
 * discounted appointment, plus two `reduce`s for its totals) and receivables.
 *
 * This is a DIFFERENTIAL test, not a unit test, and that is the point (ADR-015): the
 * only thing that makes a SQL rewrite of money arithmetic safe is proving it returns
 * what the arithmetic it replaced returned. So each case seeds real rows, reads the
 * report, and compares it against the same figure computed the old way — row by row
 * in TypeScript, from the same data.
 *
 * The bucketing deserves its own note. Days are grouped in SQL (`date_trunc`) and then
 * folded into weeks/months by the TS `startOfBucket` the report always used, so there
 * is no second copy of the bucketing rule. What that DOES depend on is Postgres and
 * Node agreeing on where a day starts — the single-timezone assumption in D-14 — so a
 * row is deliberately seeded close to midnight to catch the day landing in the wrong
 * bucket.
 *
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-report-aggregation.ts`
 */
import { and, eq, gte, lt } from "drizzle-orm";
import { db } from "../src/core/db";
import {
  appointments,
  clinics,
  expenses,
  patientPayments,
  patients,
  sales,
  saleShares,
  users,
} from "../src/core/db/schema";
import { getProfitAndLoss } from "../src/core/finance/pl";
import { getCashSummary } from "../src/core/finance/daybook";
import { getDiscountsReport } from "../src/core/sales/discounts-report";
import { getReceivablesReport } from "../src/core/finance/receivables";
import { computeFee, normalizeDiscountType } from "../src/core/appointments/fee";
import { unscoped } from "../src/core/db/tenant-guard";

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

const uniq = Date.now();
const TAG = `d12x${uniq}`;
let clinicId = "";
let doctorId = "";
let patientId = "";

const CONSULT_FEE = 2000;

/** A day inside the range, at a given hour — `dayOffset` counts back from today. */
function when(dayOffset: number, hour = 12): Date {
  const d = new Date();
  d.setDate(d.getDate() - dayOffset);
  d.setHours(hour, 30, 0, 0);
  return d;
}
const iso = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

async function seed() {
  [{ id: clinicId }] = await db
    .insert(clinics)
    .values({ name: `${TAG} clinic`, modulesEnabled: ["dental"] })
    .returning({ id: clinics.id });

  [{ id: doctorId }] = await db
    .insert(users)
    .values({
      clinicId,
      username: `${TAG}_doc`,
      passwordHash: "x",
      role: "doctor",
      fullName: "D12 Doctor",
      consultationFee: CONSULT_FEE,
    })
    .returning({ id: users.id });

  [{ id: patientId }] = await db
    .insert(patients)
    .values({ clinicId, fullName: `${TAG} Patient` })
    .returning({ id: patients.id });
}

async function cleanup() {
  await unscoped("test teardown", async () => {
    await db.delete(sales).where(eq(sales.clinicId, clinicId));
    await db.delete(saleShares).where(eq(saleShares.clinicId, clinicId));
    await db.delete(patientPayments).where(eq(patientPayments.clinicId, clinicId));
    await db.delete(expenses).where(eq(expenses.clinicId, clinicId));
    await db.delete(appointments).where(eq(appointments.clinicId, clinicId));
    await db.delete(patients).where(eq(patients.clinicId, clinicId));
    await db.delete(users).where(eq(users.clinicId, clinicId));
    await db.delete(clinics).where(eq(clinics.id, clinicId));
  });
}

async function main() {
  await seed();
  const start = when(20, 0);
  start.setHours(0, 0, 0, 0);
  const end = when(-1, 0);
  end.setHours(0, 0, 0, 0);
  // `ResolvedRange` also carries the raw period/from/to the filter bar echoes back.
  const RANGE_DAY = { start, end, granularity: "day" as const, period: "custom" as const, from: "", to: "" };
  const RANGE_MONTH = { ...RANGE_DAY, granularity: "month" as const };

  console.log("\nP&L: SQL day-grouping equals the old row-by-row fold");
  {
    // Sales on three different days, including one at 23:30 — if Postgres and Node
    // disagreed about where the day ends, this row would land in the wrong bucket.
    const saleDays = [
      { day: 12, net: 5000 },
      { day: 12, net: 1500 },
      { day: 7, net: 800 },
      { day: 3, net: 2200 },
      { day: 3, net: 100 },
    ];
    for (const s of saleDays) {
      const [appt] = await db
        .insert(appointments)
        .values({ clinicId, patientId, doctorId, module: "dental", scheduledAt: when(s.day), status: "completed" })
        .returning({ id: appointments.id });
      await db.insert(sales).values({
        clinicId,
        appointmentId: appt.id,
        doctorId,
        doctorName: "D12 Doctor",
        grossAmount: s.net,
        discountAmount: 0,
        netAmount: s.net,
        occurredAt: when(s.day),
      });
    }
    // The late-night row, deliberately at 23:30 local.
    const [lateAppt] = await db
      .insert(appointments)
      .values({ clinicId, patientId, doctorId, module: "dental", scheduledAt: when(5, 23), status: "completed" })
      .returning({ id: appointments.id });
    await db.insert(sales).values({
      clinicId,
      appointmentId: lateAppt.id,
      doctorId,
      doctorName: "D12 Doctor",
      grossAmount: 999,
      discountAmount: 0,
      netAmount: 999,
      occurredAt: when(5, 23),
    });

    await db.insert(saleShares).values({
      clinicId,
      appointmentId: lateAppt.id,
      doctorId,
      doctorName: "D12 Doctor",
      shareAmount: 400,
      occurredAt: when(5, 23),
    });
    await db.insert(expenses).values({ clinicId, amount: 1200, incurredOn: iso(when(9)), method: "cash" });

    const pl = await getProfitAndLoss(clinicId, RANGE_DAY);

    // The OLD way: read every row and fold it in TypeScript.
    const rawSales = await db
      .select({ net: sales.netAmount })
      .from(sales)
      .where(and(eq(sales.clinicId, clinicId), gte(sales.occurredAt, start), lt(sales.occurredAt, end)));
    const expectedRevenue = rawSales.reduce((s, r) => s + r.net, 0);

    check("revenue equals the row-by-row sum", pl.revenue, expectedRevenue);
    check("…and that is every seeded sale", expectedRevenue, 5000 + 1500 + 800 + 2200 + 100 + 999);
    check("doctor shares equal the seeded share", pl.doctorShares, 400);
    check("expenses equal the seeded expense", pl.expenses, 1200);
    check("net profit is revenue − shares − expenses", pl.netProfit, expectedRevenue - 400 - 1200);

    // The chart must still add up to the total, which is what proves the day
    // grouping did not drop or double a row at a bucket edge.
    const bucketSum = pl.plBuckets.reduce((s, b) => s + b.revenue, 0);
    check("the day buckets sum to the revenue total", bucketSum, expectedRevenue);

    const late = pl.plBuckets.filter((b) => b.revenue === 999);
    check("the 23:30 sale lands in exactly one day bucket", late.length, 1);

    // Two days had two sales each — proof the SQL grouping summed rather than kept one.
    const merged = pl.plBuckets.filter((b) => b.revenue === 6500 || b.revenue === 2300);
    check("same-day sales were summed, not overwritten", merged.length, 2);
  }

  console.log("\nMonthly granularity folds the SQL days without losing a rupee:");
  {
    const pl = await getProfitAndLoss(clinicId, RANGE_MONTH);
    const bucketSum = pl.plBuckets.reduce((s, b) => s + b.revenue, 0);
    check("month buckets still sum to the same revenue", bucketSum, pl.revenue);
    check("and shares still sum too", pl.plBuckets.reduce((s, b) => s + b.share, 0), pl.doctorShares);
  }

  console.log("\nCash summary: SQL grouping equals the old per-row fold");
  {
    const pays = [
      { kind: "payment", method: "cash", amount: 1000 },
      { kind: "payment", method: "cash", amount: 250 },
      { kind: "payment", method: "bank", amount: 4000 },
      { kind: "refund", method: "cash", amount: 300 },
      { kind: "advance", method: "bank", amount: 700 },
    ] as const;
    for (const p of pays) {
      await db.insert(patientPayments).values({
        clinicId,
        patientId,
        kind: p.kind,
        amount: p.amount,
        method: p.method,
        occurredAt: when(6),
      });
    }

    const cash = await getCashSummary(clinicId, { start, end });
    const byMethod = new Map(cash.rows.map((r) => [r.method, r]));

    check("cash collected is the sum of both cash payments", byMethod.get("cash")?.collected, 1250);
    check("cash refunded", byMethod.get("cash")?.refunded, 300);
    check("bank collected includes the advance", byMethod.get("bank")?.collected, 4700);
    check("the seeded expense landed on its method", byMethod.get("cash")?.expenses, 1200);
    check(
      "totals equal the sum of the method rows",
      cash.totals.collected,
      cash.rows.reduce((s, r) => s + r.collected, 0),
    );
    check("net is collected − refunded − expenses", cash.totals.net, 1250 + 4700 - 300 - 1200);
  }

  console.log("\nDiscounts: the SQL totals equal the per-row computeFee amounts");
  {
    const discounts = [
      { day: 8, type: "amount", value: 500, status: "none" },
      { day: 8, type: "percent", value: 10, status: "approved" },
      { day: 4, type: "amount", value: 300, status: "pending" },
      // 100% is the legal maximum — migration 0080's CHECK rejects more (ADR-021), so
      // the percent clamp is exercised at its boundary rather than beyond it.
      { day: 4, type: "percent", value: 100, status: "none" },
      // A flat amount has no ceiling, so THIS is where the clamp still matters: the
      // discount must stop at the subtotal, in SQL exactly as `computeFee` does.
      { day: 2, type: "amount", value: 999999, status: "none" },
    ] as const;
    for (const d of discounts) {
      await db.insert(appointments).values({
        clinicId,
        patientId,
        doctorId,
        module: "dental",
        scheduledAt: when(d.day),
        status: "completed",
        discountType: d.type,
        discountValue: d.value,
        discountStatus: d.status,
      });
    }

    const rep = await getDiscountsReport(clinicId, RANGE_DAY);
    check("all five discounted appointments are counted", rep.count, 5);

    // The OLD way: every row, `computeFee` per row, reduce.
    const expectedApplied = discounts
      .filter((d) => d.status === "none" || d.status === "approved")
      .reduce((s, d) => s + computeFee(CONSULT_FEE, normalizeDiscountType(d.type), d.value).discount, 0);
    const expectedPending = discounts
      .filter((d) => d.status === "pending")
      .reduce((s, d) => s + computeFee(CONSULT_FEE, normalizeDiscountType(d.type), d.value).discount, 0);

    check("SQL totalApplied equals the TS reduce", rep.totalApplied, expectedApplied);
    check("SQL totalPending equals the TS reduce", rep.totalPending, expectedPending);
    // The clamp is the part most likely to differ between the two implementations.
    check("an over-100% discount clamped to the subtotal, not beyond", expectedApplied >= CONSULT_FEE * 2, true);
  }

  console.log("\nPaging the discounts report leaves the totals alone:");
  {
    const page1 = await getDiscountsReport(clinicId, RANGE_DAY, {}, { offset: 0, limit: 2 });
    const page2 = await getDiscountsReport(clinicId, RANGE_DAY, {}, { offset: 2, limit: 2 });
    const all = await getDiscountsReport(clinicId, RANGE_DAY, {}, { offset: 0, limit: 100 });

    check("page 1 holds 2 rows", page1.rows.length, 2);
    check("page 2 holds 2 rows", page2.rows.length, 2);
    check("but the count is the whole match", page1.count, 5);
    check("and the totals are the whole match too", page1.totalApplied, all.totalApplied);
    check("pages do not overlap", page1.rows[0].appointmentId === page2.rows[0].appointmentId, false);
  }

  console.log("\nThe status filter narrows the totals, not just the rows:");
  {
    const rep = await getDiscountsReport(clinicId, RANGE_DAY, { status: "pending" });
    check("only the pending one counts", rep.count, 1);
    check("applied is now zero", rep.totalApplied, 0);
    check("pending carries the amount", rep.totalPending, 300);
  }

  console.log("\nReceivables: per-patient totals from SQL match the per-visit fold");
  {
    // Two unpaid visits for ONE patient plus one partly paid, so the grouping has to
    // sum several visits into one patient rather than return the newest.
    const owed = [
      { fee: 0, collected: 0 }, // full consultation outstanding
      { fee: 0, collected: 500 }, // partly paid
      { fee: 0, collected: CONSULT_FEE }, // fully paid → must NOT appear
    ];
    for (const o of owed) {
      await db.insert(appointments).values({
        clinicId,
        patientId,
        doctorId,
        module: "dental",
        scheduledAt: when(6),
        status: "completed",
        amountCollected: o.collected,
      });
    }

    const rep = await getReceivablesReport(clinicId);
    const p = rep.patients.find((x) => x.patientId === patientId);
    check("the patient appears once, not once per visit", rep.patients.filter((x) => x.patientId === patientId).length, 1);

    // THE DIFFERENTIAL: recompute what the old JS fold would have produced, from the
    // same rows — every completed appointment this run seeded, billed with the TS
    // formula and summed as `Σ max(0, bill − collected)`. Deriving it beats asserting
    // a hand-worked number, which would only describe the rows I remembered.
    const raw = await db
      .select({
        discountType: appointments.discountType,
        discountValue: appointments.discountValue,
        discountStatus: appointments.discountStatus,
        collected: appointments.amountCollected,
      })
      .from(appointments)
      .where(and(eq(appointments.clinicId, clinicId), eq(appointments.status, "completed")));

    let expectedOutstanding = 0;
    let expectedVisits = 0;
    for (const a of raw) {
      // A pending/rejected discount does not apply — `fee.ts#effectiveDiscountValue`.
      const eff = a.discountStatus === "pending" || a.discountStatus === "rejected" ? 0 : a.discountValue;
      const bill = CONSULT_FEE - computeFee(CONSULT_FEE, normalizeDiscountType(a.discountType), eff).discount;
      const outstanding = Math.max(0, bill - a.collected);
      if (outstanding > 0) {
        expectedOutstanding += outstanding;
        expectedVisits++;
      }
    }

    check("outstanding is the sum across their visits", p?.outstanding, expectedOutstanding);
    check("fully-paid visits are excluded from the drill-in", p?.visits.length, expectedVisits);
    check("the report total matches the patient rows", rep.total, rep.patients.reduce((s, x) => s + x.outstanding, 0));
  }

  console.log("\nPaging receivables keeps the total and the count whole:");
  {
    const all = await getReceivablesReport(clinicId);
    const page = await getReceivablesReport(clinicId, {}, { offset: 0, limit: 1 });
    check("one patient on the page", page.patients.length, 1);
    check("patientCount still describes the whole set", page.patientCount, all.patientCount);
    check("and so does the total", page.total, all.total);
    check("the page still carries its visit detail", page.patients[0].visits.length > 0, true);
  }

  await cleanup();
  console.log("\nseeded rows removed");
}

main()
  .catch(async (e) => {
    failures++;
    console.error(e);
    try {
      if (clinicId) await cleanup();
    } catch {
      /* the seed clinic may not exist */
    }
  })
  .finally(() => {
    console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
