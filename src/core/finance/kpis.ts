import "server-only";

import { owedVisitSql } from "@/core/finance/owed";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, users } from "@/core/db/schema";
import { precedingRange, resolveSalesRange, type ResolvedRange } from "@/core/sales/report";
import { getProfitAndLoss } from "@/core/finance/pl";
import { getDoctorBalances, getPayableTrend } from "@/core/sales/payouts";
import { appointmentNetSql } from "@/core/appointments/bill-sql";
import { procedureTotals } from "@/core/appointments/procedures";

/**
 * Owner finance KPIs for the dashboard, over the period the dashboard is showing
 * (Today / This month / 3 / 6 months / Year — owner, 2026-11-11; 30 days when no
 * period is given): collected, doctor shares, expenses and net profit, what patients
 * owe on visits in the period, and one point-in-time balance — doctors' unpaid shares,
 * which is owed as a whole and does not belong to any one period. Clinic-scoped,
 * parallel, feature-gated at the call site.
 */
export type FinanceKpis = {
  collected: number;
  netProfit: number;
  /** The SAME four figures for the window just before (`precedingRange`) — drives
   *  the KPI-card "vs previous" deltas (0 when there's no prior baseline). */
  collectedPrev: number;
  netProfitPrev: number;
  doctorSharesPrev: number;
  expensesPrev: number;
  /** The period's cost breakdown — feeds the dashboard "money flow" waterfall (same
   *  window as the KPI cards). Reused from the P&L already computed below. */
  doctorShares: number;
  expenses: number;
  /** Owed on visits in the period — the Receivables report for the same period. */
  outstandingReceivable: number;
  /** Doctors' unpaid shares TODAY — a balance, not a period figure. */
  payableToDoctors: number;
  /** Series over the period, for the KPI sparklines (the P&L's own buckets). */
  collectedTrend: number[];
  profitTrend: number[];
  sharesTrend: number[];
  expenseTrend: number[];
  /** Owed, running day by day through the period — ends at outstandingReceivable. */
  outstandingTrend: number[];
  /** Unpaid shares, running day by day through the period — ends at payableToDoctors. */
  payableTrend: number[];
};

const isoDate = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export async function getFinanceKpis(
  clinicId: string,
  range: ResolvedRange = resolveSalesRange("30d", undefined, undefined),
): Promise<FinanceKpis> {
  // The window just BEFORE `range`, for the "vs previous" deltas. Reuses the P&L math
  // verbatim (so a delta can never disagree with the report).
  const priorRange = precedingRange(range);

  // Outstanding = Σ(bill − collected) over OWED visits (`owedVisitSql` — time passed,
  // not cancelled / no-show) scheduled in the period: the Receivables report with the
  // same period, sharing its bill expression so the two always reconcile.
  //
  // JOINED, not correlated: pre-aggregating the procedures once and joining makes each
  // of the formula's three references to the subtotal a column read (`bill-sql.ts`).
  const pt = procedureTotals(clinicId);
  const netSql = appointmentNetSql(pt);

  const [pl, balances, outByDay] = await Promise.all([
    // ONE P&L pass covering both windows (the comparison returns only its scalars).
    getProfitAndLoss(clinicId, range, { comparedTo: priorRange }),
    getDoctorBalances(clinicId),
    // Owed per day over the period. The card's figure is the SUM of these rows, so the
    // running line below ends at it by construction.
    db
      .select({
        d: sql<string>`to_char(date_trunc('day', ${appointments.scheduledAt}), 'YYYY-MM-DD')`,
        v: sql<number>`coalesce(sum(greatest(${netSql} - ${appointments.amountCollected}, 0)), 0)::int`,
      })
      .from(appointments)
      .leftJoin(users, eq(users.id, appointments.doctorId))
      .leftJoin(pt, eq(pt.appointmentId, appointments.id))
      .where(
        byClinic(
          appointments.clinicId,
          clinicId,
          notDeleted(appointments.deletedAt),
          and(
            owedVisitSql(),
            gte(appointments.scheduledAt, range.start),
            lt(appointments.scheduledAt, range.end),
          ),
        ),
      )
      .groupBy(sql`date_trunc('day', ${appointments.scheduledAt})`),
  ]);

  // The prior window, totalled in the same pass. The fallback is never hit while
  // `comparedTo` is passed above; it keeps a missing baseline reading as zero deltas
  // rather than throwing.
  const prev = pl.comparison ?? { revenue: 0, doctorShares: 0, expenses: 0, netProfit: 0 };

  // Payable = Σ of each doctor's POSITIVE balance (owed to us doctors); a doctor who
  // owes the clinic (negative, from discount-bearing) doesn't reduce what we owe others.
  const payableToDoctors = balances.reduce((s, b) => s + Math.max(0, b.outstanding), 0);
  // The same balance as a daily series. Anchored to the figure above rather than
  // re-summed, so the two can never disagree (see getPayableTrend).
  const payableTrend = await getPayableTrend(clinicId, range, balances);

  // Owed, running through the period from zero → ends at the card's figure.
  const byDay = new Map(outByDay.map((r) => [r.d, Number(r.v)]));
  const outstandingTrend: number[] = [];
  let runningRec = 0;
  for (let d = new Date(range.start); d < range.end; d.setDate(d.getDate() + 1)) {
    runningRec += byDay.get(isoDate(d)) ?? 0;
    outstandingTrend.push(runningRec);
  }

  return {
    collected: pl.revenue,
    netProfit: pl.netProfit,
    collectedPrev: prev.revenue,
    netProfitPrev: prev.netProfit,
    doctorSharesPrev: prev.doctorShares,
    expensesPrev: prev.expenses,
    doctorShares: pl.doctorShares,
    expenses: pl.expenses,
    outstandingReceivable: outByDay.reduce((a, r) => a + Number(r.v), 0),
    payableToDoctors,
    collectedTrend: pl.revenueBuckets.map((b) => b.value),
    profitTrend: pl.plBuckets.map((b) => b.profit),
    sharesTrend: pl.plBuckets.map((b) => b.share),
    expenseTrend: pl.plBuckets.map((b) => b.expense),
    outstandingTrend,
    payableTrend,
  };
}
