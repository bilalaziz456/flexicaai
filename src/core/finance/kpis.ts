import "server-only";

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, users } from "@/core/db/schema";
import { resolveSalesRange, type ResolvedRange } from "@/core/sales/report";
import { getProfitAndLoss } from "@/core/finance/pl";
import { getDoctorBalances } from "@/core/sales/payouts";
import { appointmentNetSql } from "@/core/appointments/bill-sql";
import { procedureTotals } from "@/core/appointments/procedures";

/**
 * Owner finance KPIs for the dashboard — collected + net profit over the last 30
 * days, and two point-in-time balances: patients' outstanding (receivable to us) and
 * doctors' unpaid shares (payable by us). Clinic-scoped, parallel, feature-gated at
 * the call site.
 */
export type FinanceKpis = {
  collected30d: number;
  netProfit30d: number;
  /** The SAME four figures for the PREVIOUS 30-day window — drives the KPI-card
   *  "vs previous 30 days" deltas (0 when there's no prior baseline). */
  collectedPrev30d: number;
  netProfitPrev30d: number;
  doctorSharesPrev30d: number;
  expensesPrev30d: number;
  /** 30-day cost breakdown — feeds the dashboard "money flow" waterfall (same
   *  window as the KPI cards, so it stays visible on a quiet day). Reused from the
   *  P&L already computed below — no extra query. */
  doctorShares30d: number;
  expenses30d: number;
  outstandingReceivable: number;
  payableToDoctors: number;
  /** Per-day series over the last 30 days, for the KPI sparklines (reuses the P&L
   *  buckets already computed — no extra query). */
  collectedTrend: number[];
  profitTrend: number[];
  sharesTrend: number[]; // daily doctor shares (accruing) — for the Doctor-shares card
  expenseTrend: number[]; // daily expenses — for the Expenses card
  outstandingTrend: number[]; // RUNNING receivable balance — rises to outstandingReceivable
};

const isoDate = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export async function getFinanceKpis(clinicId: string): Promise<FinanceKpis> {
  const range30 = resolveSalesRange("30d", undefined, undefined);
  // The equally-long window immediately BEFORE range30, for the "vs previous" deltas.
  // Reuses the P&L math verbatim (so a delta can never disagree with the report).
  const spanMs = range30.end.getTime() - range30.start.getTime();
  const priorRange: ResolvedRange = {
    ...range30,
    period: "custom",
    start: new Date(range30.start.getTime() - spanMs),
    end: range30.start,
  };

  // Outstanding receivable = Σ(bill − collected) over completed visits. Shared bill
  // expression with the Receivables report, so the two always reconcile.
  //
  // JOINED, not correlated. All three queries below run the bill across every
  // completed visit the clinic has ever had — the balance one is deliberately
  // unbounded, because a balance is — so the correlated form read
  // `appointment_procedures` three times per row, per query. Pre-aggregating once and
  // joining makes each of the formula's three references to the subtotal a column
  // read. Same formula either way (see `bill-sql.ts`); only the inputs differ.
  const pt = procedureTotals(clinicId);
  const netSql = appointmentNetSql(pt);

  const [pl, [rec], balances, outByDay, [opening]] = await Promise.all([
    // ONE P&L pass covering both windows. This used to be two full calls — the second
    // purely to obtain four scalars for the "vs previous" deltas — which meant a
    // second complete set of aggregations, eighteen queries between them, to produce
    // eight numbers.
    getProfitAndLoss(clinicId, range30, { comparedTo: priorRange }),
    db
      .select({
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
          eq(appointments.status, "completed"),
        ),
      ),
    getDoctorBalances(clinicId),
    // Receivable ADDED per day over the window (for the Outstanding sparkline).
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
            eq(appointments.status, "completed"),
            gte(appointments.scheduledAt, range30.start),
            lt(appointments.scheduledAt, range30.end),
          ),
        ),
      )
      .groupBy(sql`date_trunc('day', ${appointments.scheduledAt})`),
    // Opening receivable — completed visits BEFORE the window — to seed the running line.
    db
      .select({
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
          and(eq(appointments.status, "completed"), lt(appointments.scheduledAt, range30.start)),
        ),
      ),
  ]);

  // The prior window, totalled in the same pass. The fallback is never hit while
  // `comparedTo` is passed above; it keeps a missing baseline reading as zero deltas
  // rather than throwing.
  const prev = pl.comparison ?? { revenue: 0, doctorShares: 0, expenses: 0, netProfit: 0 };

  // Payable = Σ of each doctor's POSITIVE balance (owed to us doctors); a doctor who
  // owes the clinic (negative, from discount-bearing) doesn't reduce what we owe others.
  const payableToDoctors = balances.reduce((s, b) => s + Math.max(0, b.outstanding), 0);

  // RUNNING receivable balance: seed with the opening (visits before the window), then
  // add each day's new receivable → the line rises to `outstandingReceivable`.
  const byDay = new Map(outByDay.map((r) => [r.d, Number(r.v)]));
  const outstandingTrend: number[] = [];
  let runningRec = Number(opening?.v ?? 0);
  for (let d = new Date(range30.start); d < range30.end; d.setDate(d.getDate() + 1)) {
    runningRec += byDay.get(isoDate(d)) ?? 0;
    outstandingTrend.push(runningRec);
  }

  return {
    collected30d: pl.revenue,
    netProfit30d: pl.netProfit,
    collectedPrev30d: prev.revenue,
    netProfitPrev30d: prev.netProfit,
    doctorSharesPrev30d: prev.doctorShares,
    expensesPrev30d: prev.expenses,
    doctorShares30d: pl.doctorShares,
    expenses30d: pl.expenses,
    outstandingReceivable: Number(rec?.v ?? 0),
    payableToDoctors,
    collectedTrend: pl.revenueBuckets.map((b) => b.value),
    profitTrend: pl.plBuckets.map((b) => b.profit),
    sharesTrend: pl.plBuckets.map((b) => b.share),
    expenseTrend: pl.plBuckets.map((b) => b.expense),
    outstandingTrend,
  };
}
