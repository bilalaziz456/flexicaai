import "server-only";

import { eq, sql } from "drizzle-orm";
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
};

export async function getFinanceKpis(clinicId: string): Promise<FinanceKpis> {
  const range30 = resolveSalesRange("30d", undefined, undefined);

  // Outstanding receivable = Σ(bill − collected) over completed visits. Shared bill
  // expression with the Receivables report, so the two always reconcile.
  const netSql = appointmentBillNetSql();

  const [pl, [rec], balances] = await Promise.all([
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
  ]);

  // Payable = Σ of each doctor's POSITIVE balance (owed to us doctors); a doctor who
  // owes the clinic (negative, from discount-bearing) doesn't reduce what we owe others.
  const payableToDoctors = balances.reduce((s, b) => s + Math.max(0, b.outstanding), 0);

  return {
    collected30d: pl.revenue,
    netProfit30d: pl.netProfit,
    outstandingReceivable: Number(rec?.v ?? 0),
    payableToDoctors,
    collectedTrend: pl.revenueBuckets.map((b) => b.value),
    profitTrend: pl.plBuckets.map((b) => b.profit),
  };
}
