import "server-only";

import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import {
  discountSettlements,
  doctorSettlementActions,
  expenseCategories,
  expenses,
  sales,
  saleShares,
} from "@/core/db/schema";
import {
  bucketLabel,
  nextBucket,
  startOfBucket,
  type ResolvedRange,
  type SalesBucket,
} from "@/core/sales/report";

/**
 * Profit & Loss (Finance) — CORE. On a COLLECTED basis (Phase 2): revenue is money
 * actually received (`sales.net`), the doctor-share cost accrues with it
 * (`sale_shares`), and expenses are what was incurred. Net profit = revenue −
 * doctor shares − expenses. Clinic-scoped. Reuses the sales report's range/bucket
 * helpers so periods line up with the Sales & Shares reports.
 */
export type PLBucket = { label: string; revenue: number; share: number; expense: number; profit: number };

export type ProfitAndLoss = {
  revenue: number;
  doctorShares: number;
  expenses: number;
  netProfit: number;
  revenueBuckets: SalesBucket[]; // for the chart
  plBuckets: PLBucket[]; // revenue/expense/profit per period
  byExpenseCategory: { name: string; amount: number }[];
  byDoctor: { name: string; amount: number }[];
};

const isoDate = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * P&L cost of a settlement action. A clinic waive / write-off is a clinic COST (it
 * gives back the doctor's borne amount); a doctor waive is a SAVING; a repayment is
 * cash-only (the bearing it settles was already accrued via `discount_settlements`).
 */
function plActionEffect(kind: string, amount: number): number {
  if (kind === "doctor_waive") return -amount;
  if (kind === "clinic_waive" || kind === "write_off") return amount;
  return 0; // repayment
}

/**
 * The four scalars a KPI card needs. Same arithmetic as the full report — this is the
 * report's own totals, named, not a second implementation of them.
 */
export type PlTotals = {
  revenue: number;
  doctorShares: number;
  expenses: number;
  netProfit: number;
};

export async function getProfitAndLoss(
  clinicId: string,
  range: ResolvedRange,
  /**
   * A second, non-overlapping span to total in the SAME pass — the dashboard's
   * "vs previous 30 days" comparison. It returns only the four scalars, because that
   * is all a delta needs; buckets and breakdowns are still built for `range` alone.
   */
  opts: { comparedTo?: ResolvedRange } = {},
): Promise<ProfitAndLoss & { comparison?: PlTotals }> {
  const { start, end, granularity } = range;
  const cmp = opts.comparedTo;

  // ONE PASS OVER BOTH WINDOWS. The dashboard used to call this function twice —
  // current window and prior window — for four scalars it could not otherwise get,
  // which cost a second full set of aggregations (eighteen queries between them) to
  // produce eight numbers. Widening the scan to span both and tagging each grouped row
  // with the window it belongs to gets the same answer in one pass.
  //
  // The tag is computed from the ROW'S OWN timestamp against each window's exact
  // bounds, not from the grouped day. `resolveSalesRange` happens to return
  // midnight-aligned boundaries today, so a day-string comparison would agree — but a
  // caller can pass a custom range, and then a boundary day belongs partly to each
  // window. Deciding per row keeps this correct without depending on that.
  const spanStart = cmp && cmp.start < start ? cmp.start : start;
  const spanEnd = cmp && cmp.end > end ? cmp.end : end;

  // AGGREGATED BY DAY IN SQL, not row by row (delta D-12). These used to select every
  // sale, share, settlement, action and expense in the range and fold them in
  // JavaScript — unbounded scans to produce four scalars and a handful of chart
  // buckets, so a clinic's P&L for a year pulled a year of transactions into memory.
  //
  // The day is the finest bucket the report can ask for, so grouping there loses
  // nothing and bounds every result by the LENGTH OF THE RANGE (about 365 rows for a
  // year) rather than by how busy the clinic is. Days are then folded into the
  // requested granularity by the same `startOfBucket` the report already used —
  // deliberately NOT mirroring that function in SQL, because a second copy of a
  // bucketing rule drifts exactly like a second copy of a bill formula (ADR-015).
  //
  // `date_trunc` on a timestamptz truncates in the session's timezone, which is the
  // server's — the same clock the TS side reads. That is the D-14 assumption, and it
  // is why this is safe today and must be revisited with per-clinic timezones.
  const day = (col: PgColumn) => sql<string>`date_trunc('day', ${col})::date::text`;

  // EACH WINDOW IS ITS OWN FILTERED AGGREGATE, decided from the row's own timestamp
  // against that window's exact bounds. The grouping stays `by day` alone.
  //
  // The first attempt tagged each row with a window number and grouped by that too,
  // and Postgres rejected it: the tag carries BIND PARAMETERS, and the copy in SELECT
  // gets different placeholder numbers from the copy in GROUP BY, so they are not the
  // same expression as far as the planner is concerned. `filter (where …)` avoids the
  // problem entirely and reads better — and it does not depend on window boundaries
  // being midnight-aligned, which `resolveSalesRange` happens to give us today but a
  // custom range need not.
  const inCur = (col: PgColumn) => sql`${col} >= ${start} and ${col} < ${end}`;
  const inPrev = (col: PgColumn) =>
    cmp ? sql`${col} >= ${cmp.start} and ${col} < ${cmp.end}` : sql`false`;
  /** Sum of `expr` restricted to one window; 0 rather than NULL when nothing matches. */
  const windowed = (expr: SQL, pred: SQL) => sql<number>`coalesce(sum(${expr}) filter (where ${pred}), 0)::int`;

  /** The same pair for `expenses.incurred_on`, which is a DATE, not a timestamptz. */
  const expInCur = sql`${expenses.incurredOn} >= ${isoDate(start)} and ${expenses.incurredOn} < ${isoDate(end)}`;
  const expInPrev = cmp
    ? sql`${expenses.incurredOn} >= ${isoDate(cmp.start)} and ${expenses.incurredOn} < ${isoDate(cmp.end)}`
    : sql`false`;

  const [saleRows, shareRows, settleRows, expRows, expByCat, sharesByDoctor, settleByDoctor, actionRows] = await Promise.all([
    db
      .select({
        day: day(sales.occurredAt),
        cur: windowed(sql`${sales.netAmount}`, inCur(sales.occurredAt)),
        prev: windowed(sql`${sales.netAmount}`, inPrev(sales.occurredAt)),
      })
      .from(sales)
      .where(byClinic(sales.clinicId, clinicId, and(gte(sales.occurredAt, spanStart), lt(sales.occurredAt, spanEnd))))
      .groupBy(day(sales.occurredAt)),
    db
      .select({
        day: day(saleShares.occurredAt),
        cur: windowed(sql`${saleShares.shareAmount}`, inCur(saleShares.occurredAt)),
        prev: windowed(sql`${saleShares.shareAmount}`, inPrev(saleShares.occurredAt)),
      })
      .from(saleShares)
      .where(byClinic(saleShares.clinicId, clinicId, and(gte(saleShares.occurredAt, spanStart), lt(saleShares.occurredAt, spanEnd))))
      .groupBy(day(saleShares.occurredAt)),
    // Discount settlements (doctor rows) — the accrual bearing folds into "doctor share".
    db
      .select({
        day: day(discountSettlements.occurredAt),
        cur: windowed(sql`${discountSettlements.settlementAmount}`, inCur(discountSettlements.occurredAt)),
        prev: windowed(sql`${discountSettlements.settlementAmount}`, inPrev(discountSettlements.occurredAt)),
      })
      .from(discountSettlements)
      .where(byClinic(discountSettlements.clinicId, clinicId, and(eq(discountSettlements.party, "doctor"), gte(discountSettlements.occurredAt, spanStart), lt(discountSettlements.occurredAt, spanEnd))))
      .groupBy(day(discountSettlements.occurredAt)),
    db
      .select({
        incurredOn: expenses.incurredOn,
        cur: windowed(sql`${expenses.amount}`, expInCur),
        prev: windowed(sql`${expenses.amount}`, expInPrev),
      })
      .from(expenses)
      .groupBy(expenses.incurredOn)
      .where(
        byClinic(
          expenses.clinicId,
          clinicId,
          notDeleted(expenses.deletedAt),
          and(gte(expenses.incurredOn, isoDate(spanStart)), lt(expenses.incurredOn, isoDate(spanEnd))),
        ),
      ),
    // The three breakdowns below feed the REPORT only, never a delta, so they stay
    // scoped to `range` rather than being widened.
    db
      .select({ name: expenseCategories.name, amount: sql<number>`sum(${expenses.amount})::int` })
      .from(expenses)
      .leftJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
      .where(
        byClinic(
          expenses.clinicId,
          clinicId,
          notDeleted(expenses.deletedAt),
          and(gte(expenses.incurredOn, isoDate(start)), lt(expenses.incurredOn, isoDate(end))),
        ),
      )
      .groupBy(expenseCategories.name)
      .orderBy(desc(sql`sum(${expenses.amount})`)),
    db
      .select({ name: saleShares.doctorName, amount: sql<number>`sum(${saleShares.shareAmount})::int` })
      .from(saleShares)
      .where(byClinic(saleShares.clinicId, clinicId, and(gte(saleShares.occurredAt, start), lt(saleShares.occurredAt, end))))
      .groupBy(saleShares.doctorName)
      .orderBy(desc(sql`sum(${saleShares.shareAmount})`)),
    db
      .select({ name: discountSettlements.doctorName, amount: sql<number>`sum(${discountSettlements.settlementAmount})::int` })
      .from(discountSettlements)
      .where(byClinic(discountSettlements.clinicId, clinicId, and(eq(discountSettlements.party, "doctor"), gte(discountSettlements.occurredAt, start), lt(discountSettlements.occurredAt, end))))
      .groupBy(discountSettlements.doctorName),
    // Settlement actions — grouped by (day, kind), since `plActionEffect` decides the
    // SIGN from the kind. Bounded by days times the five kinds, not by how many.
    db
      .select({
        kind: doctorSettlementActions.kind,
        name: doctorSettlementActions.doctorName,
        day: day(doctorSettlementActions.occurredAt),
        cur: windowed(sql`${doctorSettlementActions.amount}`, inCur(doctorSettlementActions.occurredAt)),
        prev: windowed(sql`${doctorSettlementActions.amount}`, inPrev(doctorSettlementActions.occurredAt)),
      })
      .from(doctorSettlementActions)
      .where(byClinic(doctorSettlementActions.clinicId, clinicId, and(gte(doctorSettlementActions.occurredAt, spanStart), lt(doctorSettlementActions.occurredAt, spanEnd))))
      // Also grouped by doctor, because these rows feed the per-doctor breakdown too.
      .groupBy(doctorSettlementActions.kind, doctorSettlementActions.doctorName, day(doctorSettlementActions.occurredAt)),
  ]);

  /** A grouped day back to a local Date, so `startOfBucket` sees what it always saw. */
  const dayDate = (d: string) => new Date(`${d}T12:00:00`);

  /** Which window's column to read. Every grouped row above carries both. */
  type Windowed = { cur: number; prev: number };
  const CURRENT = (r: Windowed) => r.cur;
  const PRIOR = (r: Windowed) => r.prev;

  /** The four scalars for one window. ONE definition, read twice. */
  const totalsOf = (pick: (r: Windowed) => number): PlTotals => {
    const sum = <T extends Windowed>(rows: T[]) => rows.reduce((s, r) => s + pick(r), 0);
    const revenue = sum(saleRows);
    // Doctor shares (the clinic's cost to doctors) = gross earnings + settlements (the
    // accrual bearing) + settlement ACTIONS (a clinic waive/write-off is a cost, a
    // doctor waive a saving; a repayment is cash-only — already accrued via bearing).
    const doctorShares =
      sum(shareRows) +
      sum(settleRows) +
      actionRows.reduce((s, r) => s + plActionEffect(r.kind, pick(r)), 0);
    // Summed from the rows already read rather than a separate `expensesTotal` query:
    // that query is `sum(amount)` over this exact predicate, so it was a second round
    // trip for a number already in hand. `scripts/test-pl-windows.ts` asserts they agree.
    const expensesSum = sum(expRows);
    return { revenue, doctorShares, expenses: expensesSum, netProfit: revenue - doctorShares - expensesSum };
  };

  const cur = totalsOf(CURRENT);
  const comparison = cmp ? totalsOf(PRIOR) : undefined;

  // Buckets: revenue (sales.occurred_at), doctor share, and expense (incurred_on).
  // They read the CURRENT column only, so the widened scan cannot reach them — which
  // matters at a granularity coarser than a day, where a prior-window day and a
  // current-window day genuinely share a bucket.
  type B = { label: string; revenue: number; share: number; expense: number };
  const buckets: B[] = [];
  const idx = new Map<number, number>();
  for (let curB = startOfBucket(start, granularity); curB < end; curB = nextBucket(curB, granularity)) {
    idx.set(curB.getTime(), buckets.length);
    buckets.push({ label: bucketLabel(curB, granularity), revenue: 0, share: 0, expense: 0 });
  }
  for (const r of saleRows) {
    const b = idx.get(startOfBucket(dayDate(r.day), granularity).getTime());
    if (b !== undefined) buckets[b].revenue += r.cur;
  }
  for (const r of shareRows) {
    const b = idx.get(startOfBucket(dayDate(r.day), granularity).getTime());
    if (b !== undefined) buckets[b].share += r.cur;
  }
  for (const r of settleRows) {
    const b = idx.get(startOfBucket(dayDate(r.day), granularity).getTime());
    if (b !== undefined) buckets[b].share += r.cur;
  }
  for (const r of actionRows) {
    const b = idx.get(startOfBucket(dayDate(r.day), granularity).getTime());
    if (b !== undefined) buckets[b].share += plActionEffect(r.kind, r.cur);
  }
  for (const r of expRows) {
    const d = new Date(`${r.incurredOn}T12:00:00`);
    const b = idx.get(startOfBucket(d, granularity).getTime());
    if (b !== undefined) buckets[b].expense += r.cur;
  }

  return {
    revenue: cur.revenue,
    doctorShares: cur.doctorShares,
    expenses: cur.expenses,
    netProfit: cur.netProfit,
    ...(comparison ? { comparison } : {}),
    revenueBuckets: buckets.map((b) => ({ label: b.label, value: b.revenue })),
    plBuckets: buckets.map((b) => ({
      label: b.label,
      revenue: b.revenue,
      share: b.share,
      expense: b.expense,
      profit: b.revenue - b.share - b.expense,
    })),
    byExpenseCategory: expByCat.map((r) => ({ name: r.name ?? "Uncategorized", amount: Number(r.amount) })),
    byDoctor: mergeByName(
      sharesByDoctor,
      settleByDoctor,
      actionRows.map((r) => ({ name: r.name, amount: plActionEffect(r.kind, r.cur) })),
    ),
  };
}

/** Merge name→amount lists (shares + settlements + actions) into one, summed, desc. */
function mergeByName(
  ...lists: { name: string | null; amount: number }[][]
): { name: string; amount: number }[] {
  const m = new Map<string, number>();
  for (const list of lists)
    for (const r of list) {
      const name = r.name ?? "Unknown";
      m.set(name, (m.get(name) ?? 0) + Number(r.amount));
    }
  return [...m.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((x, y) => y.amount - x.amount);
}
