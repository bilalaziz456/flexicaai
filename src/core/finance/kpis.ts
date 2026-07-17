import "server-only";

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, users } from "@/core/db/schema";
import { resolveSalesRange } from "@/core/sales/report";
import { getProfitAndLoss } from "@/core/finance/pl";
import { getDoctorBalances } from "@/core/sales/payouts";
import { appointmentBillNetSql } from "@/core/finance/receivables";

/**
 * Owner finance KPIs for the dashboard — collected + net profit over the last 30
 * days, and two point-in-time balances: patients' outstanding (receivable to us) and
 * doctors' unpaid shares (payable by us). Clinic-scoped, parallel, feature-gated at
 * the call site.
 */
export type FinanceKpis = {
  collected30d: number;
  netProfit30d: number;
  outstandingReceivable: number;
  payableToDoctors: number;
  /** Per-day series over the last 30 days, for the KPI sparklines (reuses the P&L
   *  buckets already computed — no extra query). */
  collectedTrend: number[];
  profitTrend: number[];
  sharesTrend: number[]; // daily doctor shares (accruing) — for the Payable card
  outstandingTrend: number[]; // daily receivable added — for the Outstanding card
};

const isoDate = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export async function getFinanceKpis(clinicId: string): Promise<FinanceKpis> {
  const range30 = resolveSalesRange("30d", undefined, undefined);

  // Outstanding receivable = Σ(bill − collected) over completed visits. Shared bill
  // expression with the Receivables report, so the two always reconcile.
  const netSql = appointmentBillNetSql();

  const [pl, [rec], balances, outByDay] = await Promise.all([
    getProfitAndLoss(clinicId, range30),
    db
      .select({
        v: sql<number>`coalesce(sum(greatest(${netSql} - ${appointments.amountCollected}, 0)), 0)::int`,
      })
      .from(appointments)
      .leftJoin(users, eq(users.id, appointments.doctorId))
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
  ]);

  // Payable = Σ of each doctor's POSITIVE balance (owed to us doctors); a doctor who
  // owes the clinic (negative, from discount-bearing) doesn't reduce what we owe others.
  const payableToDoctors = balances.reduce((s, b) => s + Math.max(0, b.outstanding), 0);

  // Build the outstanding-added series over the same days as the P&L buckets.
  const byDay = new Map(outByDay.map((r) => [r.d, Number(r.v)]));
  const outstandingTrend: number[] = [];
  for (let d = new Date(range30.start); d < range30.end; d.setDate(d.getDate() + 1)) {
    outstandingTrend.push(byDay.get(isoDate(d)) ?? 0);
  }

  return {
    collected30d: pl.revenue,
    netProfit30d: pl.netProfit,
    outstandingReceivable: Number(rec?.v ?? 0),
    payableToDoctors,
    collectedTrend: pl.revenueBuckets.map((b) => b.value),
    profitTrend: pl.plBuckets.map((b) => b.profit),
    sharesTrend: pl.plBuckets.map((b) => b.share),
    outstandingTrend,
  };
}
