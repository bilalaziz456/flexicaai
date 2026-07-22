import "server-only";

import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { notDeleted } from "@/core/db/tenant";
import { clinics, clinicPayments } from "@/core/db/schema";
import { listDueClinics } from "./billing";

/**
 * Company financial metrics — CORE, super-admin control plane (Feature 8, "how much
 * are WE earning"). Cross-tenant aggregates (bounded by date + index), so the whole
 * thing runs inside ONE `unscoped` opt-out of the tenant guard. AI/WhatsApp cost +
 * gross margin need the Feature-7 unit-cost config (not built) and are omitted here.
 * See docs/super-admin-plan.md §11 Feature 8.
 */

export type CompanyMetrics = {
  totalClinics: number;
  clinicsByStatus: Record<string, number>;
  /** Monthly recurring revenue = Σ active clinics' monthly_price. */
  mrr: number;
  newThisMonth: number;
  collectedThisMonth: number;
  collectedThisYear: number;
  overdueTotal: number;
  overdueCount: number;
  /** Collected per month, last 6 months (oldest→newest) for a sparkline. */
  collectionTrend: number[];
  trendLabels: string[];
  topClinics: { id: string; name: string; total: number }[];
};

const num = (v: unknown): number => Number(v ?? 0);

export async function getCompanyMetrics(now: Date = new Date()): Promise<CompanyMetrics> {
  return unscoped("admin: company metrics", async () => {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const trendStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    // Clinics by lifecycle status.
    const statusRows = await db
      .select({ status: clinics.status, c: count() })
      .from(clinics)
      .where(notDeleted(clinics.deletedAt))
      .groupBy(clinics.status);
    const clinicsByStatus: Record<string, number> = {};
    let totalClinics = 0;
    for (const r of statusRows) {
      clinicsByStatus[r.status] = num(r.c);
      totalClinics += num(r.c);
    }

    // MRR = Σ active monthly_price; new clinics this month.
    const [{ mrr }] = await db
      .select({ mrr: sql<number>`coalesce(sum(${clinics.monthlyPrice}),0)` })
      .from(clinics)
      .where(and(notDeleted(clinics.deletedAt), eq(clinics.status, "active")));
    const [{ n: newThisMonth }] = await db
      .select({ n: count() })
      .from(clinics)
      .where(and(notDeleted(clinics.deletedAt), gte(clinics.createdAt, monthStart)));

    // Collected (money in from clinics) this month / year.
    const [{ m: collectedThisMonth }] = await db
      .select({ m: sql<number>`coalesce(sum(${clinicPayments.amount}),0)` })
      .from(clinicPayments)
      .where(and(notDeleted(clinicPayments.deletedAt), gte(clinicPayments.occurredAt, monthStart)));
    const [{ y: collectedThisYear }] = await db
      .select({ y: sql<number>`coalesce(sum(${clinicPayments.amount}),0)` })
      .from(clinicPayments)
      .where(and(notDeleted(clinicPayments.deletedAt), gte(clinicPayments.occurredAt, yearStart)));

    // Monthly collection for the last 6 months → sparkline (fill gaps with 0).
    const trendRows = await db
      .select({
        m: sql<string>`to_char(date_trunc('month', ${clinicPayments.occurredAt}), 'YYYY-MM')`,
        s: sql<number>`coalesce(sum(${clinicPayments.amount}),0)`,
      })
      .from(clinicPayments)
      .where(and(notDeleted(clinicPayments.deletedAt), gte(clinicPayments.occurredAt, trendStart)))
      .groupBy(sql`date_trunc('month', ${clinicPayments.occurredAt})`);
    const trendMap = new Map(trendRows.map((r) => [r.m, num(r.s)]));
    const collectionTrend: number[] = [];
    const trendLabels: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      collectionTrend.push(trendMap.get(key) ?? 0);
      trendLabels.push(d.toLocaleDateString(undefined, { month: "short" }));
    }

    // Top clinics by revenue this year.
    const topRows = await db
      .select({
        id: clinicPayments.clinicId,
        name: clinics.name,
        total: sql<number>`coalesce(sum(${clinicPayments.amount}),0)`,
      })
      .from(clinicPayments)
      .innerJoin(clinics, eq(clinicPayments.clinicId, clinics.id))
      .where(and(notDeleted(clinicPayments.deletedAt), gte(clinicPayments.occurredAt, yearStart)))
      .groupBy(clinicPayments.clinicId, clinics.name)
      .orderBy(desc(sql`sum(${clinicPayments.amount})`))
      .limit(5);

    // Overdue total (reuse the billing balance math).
    const due = await listDueClinics();
    const overdueTotal = due.reduce((s, c) => s + c.balance.owed, 0);

    return {
      totalClinics,
      clinicsByStatus,
      mrr: num(mrr),
      newThisMonth: num(newThisMonth),
      collectedThisMonth: num(collectedThisMonth),
      collectedThisYear: num(collectedThisYear),
      overdueTotal,
      overdueCount: due.length,
      collectionTrend,
      trendLabels,
      topClinics: topRows.map((r) => ({ id: r.id, name: r.name, total: num(r.total) })),
    };
  });
}
