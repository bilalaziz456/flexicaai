import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, doctorPayouts, saleShares, users } from "@/core/db/schema";
import { resolveSalesRange } from "@/core/sales/report";
import { getProfitAndLoss } from "@/core/finance/pl";
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
};

export async function getFinanceKpis(clinicId: string): Promise<FinanceKpis> {
  const range30 = resolveSalesRange("30d", undefined, undefined);

  // Outstanding receivable = Σ(bill − collected) over completed visits. Shared bill
  // expression with the Receivables report, so the two always reconcile.
  const netSql = appointmentBillNetSql();

  const [pl, [rec], [earned], [paid]] = await Promise.all([
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
    db
      .select({ v: sql<number>`coalesce(sum(${saleShares.shareAmount}), 0)::int` })
      .from(saleShares)
      .where(eq(saleShares.clinicId, clinicId)),
    db
      .select({ v: sql<number>`coalesce(sum(${doctorPayouts.amount}), 0)::int` })
      .from(doctorPayouts)
      .where(eq(doctorPayouts.clinicId, clinicId)),
  ]);

  return {
    collected30d: pl.revenue,
    netProfit30d: pl.netProfit,
    outstandingReceivable: Number(rec?.v ?? 0),
    payableToDoctors: Math.max(0, Number(earned?.v ?? 0) - Number(paid?.v ?? 0)),
  };
}
