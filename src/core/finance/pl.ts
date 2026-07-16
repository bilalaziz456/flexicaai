import "server-only";

import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
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

export async function getProfitAndLoss(
  clinicId: string,
  range: ResolvedRange,
): Promise<ProfitAndLoss> {
  const { start, end, granularity } = range;

  const [saleRows, shareRows, settleRows, expRows, expByCat, sharesByDoctor, settleByDoctor, actionRows] = await Promise.all([
    db
      .select({ net: sales.netAmount, occurredAt: sales.occurredAt })
      .from(sales)
      .where(byClinic(sales.clinicId, clinicId, and(gte(sales.occurredAt, start), lt(sales.occurredAt, end))))
      .orderBy(asc(sales.occurredAt)),
    db
      .select({ amount: saleShares.shareAmount, occurredAt: saleShares.occurredAt })
      .from(saleShares)
      .where(byClinic(saleShares.clinicId, clinicId, and(gte(saleShares.occurredAt, start), lt(saleShares.occurredAt, end)))),
    // Discount settlements (doctor rows) — the accrual bearing folds into "doctor share".
    db
      .select({ amount: discountSettlements.settlementAmount, occurredAt: discountSettlements.occurredAt })
      .from(discountSettlements)
      .where(byClinic(discountSettlements.clinicId, clinicId, and(eq(discountSettlements.party, "doctor"), gte(discountSettlements.occurredAt, start), lt(discountSettlements.occurredAt, end)))),
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
    db
      .select({ name: discountSettlements.doctorName, amount: sql<number>`sum(${discountSettlements.settlementAmount})::int` })
      .from(discountSettlements)
      .where(byClinic(discountSettlements.clinicId, clinicId, and(eq(discountSettlements.party, "doctor"), gte(discountSettlements.occurredAt, start), lt(discountSettlements.occurredAt, end))))
      .groupBy(discountSettlements.doctorName),
    // Settlement actions in the range — their P&L cost (see plActionEffect).
    db
      .select({ kind: doctorSettlementActions.kind, amount: doctorSettlementActions.amount, occurredAt: doctorSettlementActions.occurredAt, name: doctorSettlementActions.doctorName })
      .from(doctorSettlementActions)
      .where(byClinic(doctorSettlementActions.clinicId, clinicId, and(gte(doctorSettlementActions.occurredAt, start), lt(doctorSettlementActions.occurredAt, end)))),
  ]);

  const revenue = saleRows.reduce((s, r) => s + r.net, 0);
  // Doctor shares (the clinic's cost to doctors) = gross earnings + settlements (the
  // accrual bearing) + settlement ACTIONS (a clinic waive/write-off is a cost, a doctor
  // waive a saving; a repayment is cash-only — the bearing was already accrued).
  const actionShares = actionRows.reduce((s, r) => s + plActionEffect(r.kind, r.amount), 0);
  const doctorShares =
    shareRows.reduce((s, r) => s + r.amount, 0) +
    settleRows.reduce((s, r) => s + r.amount, 0) +
    actionShares;
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
  for (const r of settleRows) {
    const b = idx.get(startOfBucket(r.occurredAt, granularity).getTime());
    if (b !== undefined) buckets[b].share += r.amount;
  }
  for (const r of actionRows) {
    const b = idx.get(startOfBucket(r.occurredAt, granularity).getTime());
    if (b !== undefined) buckets[b].share += plActionEffect(r.kind, r.amount);
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
    byDoctor: mergeByName(
      sharesByDoctor,
      settleByDoctor,
      actionRows.map((r) => ({ name: r.name, amount: plActionEffect(r.kind, r.amount) })),
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
