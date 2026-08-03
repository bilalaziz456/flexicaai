import "server-only";

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { notDeleted } from "@/core/db/tenant";
import { clinics, clinicPayments } from "@/core/db/schema";
import { computeServingCost } from "@/core/admin/cost";
import { companyExpensesTotal, companyExpensesTrend } from "@/core/admin/company-expenses";
import {
  bucketLabel,
  nextBucket,
  startOfBucket,
  type ResolvedRange,
} from "@/core/sales/report";

/**
 * Company P&L (Owner Finance, Phase 3) — "how much are WE earning?". CASH BASIS:
 *
 *   Net profit = Collected revenue (clinic_payments)
 *              − Variable serving cost (AI scribe + WhatsApp, core/admin/cost)
 *              − Operating expenses (core/admin/company-expenses)
 *
 * MRR/ARR are shown alongside as the forward run-rate (accrual), not folded into the
 * actuals. Per-clinic margin = that clinic's collected revenue − its serving cost
 * (opex is company-wide, not per-clinic). Reuses `computeServingCost` + the company
 * expense aggregates + the sales-report bucket helpers so every trend lines up.
 * clinic_payments/clinics are cross-tenant → `unscoped`.
 */

const num = (v: unknown): number => Number(v ?? 0);

export type PnlClinic = {
  clinicId: string;
  name: string;
  revenue: number;
  servingCost: number;
  margin: number; // revenue − servingCost
};

export type PnlBucket = {
  label: string;
  revenue: number;
  cost: number; // serving + opex
  netProfit: number; // revenue − cost
};

export type CompanyPnl = {
  from: Date;
  to: Date;
  revenue: number;
  servingCost: number;
  operatingExpenses: number;
  grossMargin: number; // revenue − serving cost
  netProfit: number; // gross margin − opex
  marginPct: number | null; // net profit / revenue (null when no revenue)
  mrr: number;
  arr: number;
  perClinic: PnlClinic[];
  trend: PnlBucket[];
};

export async function getCompanyPnl(range: ResolvedRange): Promise<CompanyPnl> {
  const { start, end, granularity } = range;

  // Serving cost (its own unscoped block) + company opex (no clinic_id, ungated).
  const [serving, opexTotal, opexTrend] = await Promise.all([
    computeServingCost(range),
    companyExpensesTotal(start, end),
    companyExpensesTrend(range),
  ]);

  return unscoped("admin: company P&L", async () => {
    // Collected revenue rows (CASH clinics paid FlexicaAI) in the window — payment counts
    // in, refund out, a non-cash credit is excluded.
    const payRows = await db
      .select({ clinicId: clinicPayments.clinicId, amount: clinicPayments.amount, kind: clinicPayments.kind, at: clinicPayments.occurredAt })
      .from(clinicPayments)
      .where(and(notDeleted(clinicPayments.deletedAt), gte(clinicPayments.occurredAt, start), lt(clinicPayments.occurredAt, end)));

    // MRR run-rate = Σ active clinics' monthly_price.
    const [{ mrr }] = await db
      .select({ mrr: sql<number>`coalesce(sum(${clinics.monthlyPrice}),0)` })
      .from(clinics)
      .where(and(notDeleted(clinics.deletedAt), eq(clinics.status, "active")));

    // Clinic names — so a revenue-only clinic (no serving cost) still shows its name.
    const clinicRows = await db.select({ id: clinics.id, name: clinics.name }).from(clinics).where(notDeleted(clinics.deletedAt));
    const nameOf = new Map(clinicRows.map((c) => [c.id, c.name]));

    // Per-clinic + per-bucket revenue in one pass (local time, matching the cost/opex trends).
    const revByClinic = new Map<string, number>();
    const revBuckets: number[] = [];
    const bucketIndex = new Map<number, number>();
    for (let cur = startOfBucket(start, granularity); cur < end; cur = nextBucket(cur, granularity)) {
      bucketIndex.set(cur.getTime(), revBuckets.length);
      revBuckets.push(0);
    }
    let revenue = 0;
    for (const r of payRows) {
      // Cash: payment + / refund − / credit 0 (non-cash).
      const cash = r.kind === "refund" ? -r.amount : r.kind === "credit" ? 0 : r.amount;
      if (cash === 0) continue;
      revenue += cash;
      revByClinic.set(r.clinicId, (revByClinic.get(r.clinicId) ?? 0) + cash);
      const idx = bucketIndex.get(startOfBucket(r.at, granularity).getTime());
      if (idx !== undefined) revBuckets[idx] += cash;
    }

    const servingCost = serving.totalCostPkr;
    const grossMargin = revenue - servingCost;
    const netProfit = grossMargin - opexTotal;
    const marginPct = revenue > 0 ? Math.round((netProfit / revenue) * 1000) / 10 : null;

    // Per-clinic margin: revenue − serving cost. Union of clinics with revenue and/or
    // cost; sorted by margin ascending so the money-losing clinics surface first.
    const costByClinic = new Map(serving.perClinic.map((c) => [c.clinicId, c]));
    const clinicIds = new Set<string>([...revByClinic.keys(), ...costByClinic.keys()]);
    const perClinic: PnlClinic[] = [...clinicIds].map((id) => {
      const rev = revByClinic.get(id) ?? 0;
      const sc = costByClinic.get(id)?.costPkr ?? 0;
      const name = nameOf.get(id) ?? costByClinic.get(id)?.name ?? "—";
      return { clinicId: id, name, revenue: rev, servingCost: sc, margin: rev - sc };
    });
    perClinic.sort((a, b) => a.margin - b.margin);

    // Zip the three trends (same range → aligned by index).
    const trend: PnlBucket[] = serving.trend.map((b, i) => {
      const rev = revBuckets[i] ?? 0;
      const cost = b.costPkr + (opexTrend[i]?.total ?? 0);
      return { label: b.label, revenue: rev, cost, netProfit: rev - cost };
    });

    return {
      from: start,
      to: end,
      revenue,
      servingCost,
      operatingExpenses: opexTotal,
      grossMargin,
      netProfit,
      marginPct,
      mrr: num(mrr),
      arr: num(mrr) * 12,
      perClinic,
      trend,
    };
  });
}
