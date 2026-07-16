import "server-only";

import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { expenseCategories, expenses, sales, saleShares } from "@/core/db/schema";
import { expensesTotal } from "@/core/expenses";
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

export async function getProfitAndLoss(
  clinicId: string,
  range: ResolvedRange,
): Promise<ProfitAndLoss> {
  const { start, end, granularity } = range;

  const [saleRows, shareRows, expRows, expByCat, sharesByDoctor] = await Promise.all([
    db
      .select({ net: sales.netAmount, occurredAt: sales.occurredAt })
      .from(sales)
      .where(byClinic(sales.clinicId, clinicId, and(gte(sales.occurredAt, start), lt(sales.occurredAt, end))))
      .orderBy(asc(sales.occurredAt)),
    db
      .select({ amount: saleShares.shareAmount, occurredAt: saleShares.occurredAt })
      .from(saleShares)
      .where(byClinic(saleShares.clinicId, clinicId, and(gte(saleShares.occurredAt, start), lt(saleShares.occurredAt, end)))),
    db
      .select({ amount: expenses.amount, incurredOn: expenses.incurredOn })
      .from(expenses)
      .where(
        byClinic(
          expenses.clinicId,
          clinicId,
          notDeleted(expenses.deletedAt),
          and(gte(expenses.incurredOn, isoDate(start)), lt(expenses.incurredOn, isoDate(end))),
        ),
      ),
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
  ]);

  const revenue = saleRows.reduce((s, r) => s + r.net, 0);
  const doctorShares = shareRows.reduce((s, r) => s + r.amount, 0);
  const expensesSum = await expensesTotal(clinicId, start, end);
  const netProfit = revenue - doctorShares - expensesSum;

  // Buckets: revenue (sales.occurred_at), doctor share, and expense (incurred_on).
  type B = { label: string; revenue: number; share: number; expense: number };
  const buckets: B[] = [];
  const idx = new Map<number, number>();
  for (let cur = startOfBucket(start, granularity); cur < end; cur = nextBucket(cur, granularity)) {
    idx.set(cur.getTime(), buckets.length);
    buckets.push({ label: bucketLabel(cur, granularity), revenue: 0, share: 0, expense: 0 });
  }
  for (const r of saleRows) {
    const b = idx.get(startOfBucket(r.occurredAt, granularity).getTime());
    if (b !== undefined) buckets[b].revenue += r.net;
  }
  for (const r of shareRows) {
    const b = idx.get(startOfBucket(r.occurredAt, granularity).getTime());
    if (b !== undefined) buckets[b].share += r.amount;
  }
  for (const r of expRows) {
    const d = new Date(`${r.incurredOn}T12:00:00`);
    const b = idx.get(startOfBucket(d, granularity).getTime());
    if (b !== undefined) buckets[b].expense += r.amount;
  }

  return {
    revenue,
    doctorShares,
    expenses: expensesSum,
    netProfit,
    revenueBuckets: buckets.map((b) => ({ label: b.label, value: b.revenue })),
    plBuckets: buckets.map((b) => ({
      label: b.label,
      revenue: b.revenue,
      share: b.share,
      expense: b.expense,
      profit: b.revenue - b.share - b.expense,
    })),
    byExpenseCategory: expByCat.map((r) => ({ name: r.name ?? "Uncategorized", amount: Number(r.amount) })),
    byDoctor: sharesByDoctor.map((r) => ({ name: r.name ?? "Unknown", amount: Number(r.amount) })),
  };
}
