import "server-only";

import { and, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { notDeleted } from "@/core/db/tenant";
import { aiUsage, clinics, clinicPayments, visits, whatsappMessages } from "@/core/db/schema";
import { getCostRates, taxMultiplier } from "./cost";
import { listDueClinics } from "./billing";
import { clinicPaymentKindId } from "@/core/db/vocabulary-seed";

/**
 * Company financial metrics — CORE, super-admin control plane (Feature 8, "how much
 * are WE earning"). Cross-tenant aggregates (bounded by date + index), so the whole
 * thing runs inside ONE `unscoped` opt-out of the tenant guard. Serving cost + gross
 * margin (this month) are folded in when `withCost` is set (Feature 7 built); they're
 * computed only then to save the cost queries for viewers who won't see them.
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
  /** Paid clinics whose subscription lapses within their reminder window ("coming up"). */
  upcomingCount: number;
  /** Σ monthly_price of those upcoming clinics (the revenue about to renew). */
  upcomingTotal: number;
  /** Estimated variable serving cost (AI + WhatsApp) this month — 0 unless `withCost`. */
  servingCostThisMonth: number;
  /** Collected this month − serving cost this month. Meaningful only with `withCost`. */
  grossMarginThisMonth: number;
  /** Whether the cost/margin figures were computed (gated on `withCost`). */
  hasCost: boolean;
  topClinics: { id: string; name: string; total: number }[];
};

const num = (v: unknown): number => Number(v ?? 0);

/**
 * @param assignedTo when set, every aggregate is SCOPED to clinics assigned to this
 *   team member (the account manager) — so a sales/support/billing user sees the
 *   MRR / collected / overdue / totals for THEIR book of business, matching the
 *   scoped clinic list. Omit for the owner / full super-admin → company-wide.
 */
export async function getCompanyMetrics(
  { assignedTo, now = new Date(), withCost = false }: { assignedTo?: string; now?: Date; withCost?: boolean } = {},
): Promise<CompanyMetrics> {
  return unscoped("admin: company metrics", async () => {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    // Scope conditions. Clinic-based queries filter on `assigned_to`; payment-based
    // queries filter via EXISTS on the owning clinic (payments carry no assignee).
    const clinicScope = assignedTo ? eq(clinics.assignedTo, assignedTo) : undefined;
    const paymentScope = assignedTo
      ? sql`exists (select 1 from ${clinics} where ${clinics.id} = ${clinicPayments.clinicId} and ${clinics.assignedTo} = ${assignedTo} and ${clinics.deletedAt} is null)`
      : undefined;
    // CASH collected: a payment counts in, a refund out, a non-cash credit is excluded.
    const cashSum = sql<number>`coalesce(sum(case when ${clinicPayments.kind} = ${clinicPaymentKindId("refund")} then -${clinicPayments.amount} when ${clinicPayments.kind} = ${clinicPaymentKindId("credit")} then 0 else ${clinicPayments.amount} end),0)`;
    const cashOrder = sql`sum(case when ${clinicPayments.kind} = ${clinicPaymentKindId("refund")} then -${clinicPayments.amount} when ${clinicPayments.kind} = ${clinicPaymentKindId("credit")} then 0 else ${clinicPayments.amount} end)`;

    // Clinics by lifecycle status.
    const statusRows = await db
      .select({ status: clinics.status, c: count() })
      .from(clinics)
      .where(and(notDeleted(clinics.deletedAt), clinicScope))
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
      .where(and(notDeleted(clinics.deletedAt), eq(clinics.status, "active"), clinicScope));
    const [{ n: newThisMonth }] = await db
      .select({ n: count() })
      .from(clinics)
      .where(and(notDeleted(clinics.deletedAt), gte(clinics.createdAt, monthStart), clinicScope));

    // Collected CASH (money in − refunds; credits excluded) this month / year.
    const [{ m: collectedThisMonth }] = await db
      .select({ m: cashSum })
      .from(clinicPayments)
      .where(and(notDeleted(clinicPayments.deletedAt), gte(clinicPayments.occurredAt, monthStart), paymentScope));
    const [{ y: collectedThisYear }] = await db
      .select({ y: cashSum })
      .from(clinicPayments)
      .where(and(notDeleted(clinicPayments.deletedAt), gte(clinicPayments.occurredAt, yearStart), paymentScope));

    // Top clinics by revenue this year.
    const topRows = await db
      .select({
        id: clinicPayments.clinicId,
        name: clinics.name,
        total: cashSum,
      })
      .from(clinicPayments)
      .innerJoin(clinics, eq(clinicPayments.clinicId, clinics.id))
      .where(and(notDeleted(clinicPayments.deletedAt), gte(clinicPayments.occurredAt, yearStart), clinicScope))
      .groupBy(clinicPayments.clinicId, clinics.name)
      .orderBy(desc(cashOrder))
      .limit(5);

    // Overdue + upcoming (reuse the billing balance math) — scoped to this manager's clinics.
    const alertsAll = await listDueClinics({ includeUpcoming: true });
    const scopedAlerts = assignedTo ? alertsAll.filter((c) => c.assignedTo === assignedTo) : alertsAll;
    const due = scopedAlerts.filter((c) => c.alert !== "upcoming");
    const upcoming = scopedAlerts.filter((c) => c.alert === "upcoming");
    const overdueTotal = due.reduce((s, c) => s + c.balance.owed, 0);
    const upcomingTotal = upcoming.reduce((s, c) => s + c.balance.monthlyPrice, 0);

    // Serving cost (this month) + gross margin — only when the viewer will see them
    // (Feature 7). Counts × rates, scoped to the assignee's clinics like the rest.
    let servingCostThisMonth = 0;
    if (withCost) {
      const rates = await getCostRates();
      const scopeExists = (col: AnyPgColumn) =>
        assignedTo
          ? sql`exists (select 1 from ${clinics} where ${clinics.id} = ${col} and ${clinics.assignedTo} = ${assignedTo} and ${clinics.deletedAt} is null)`
          : undefined;
      // METERED AI cost this month (Whisper + Claude, snapshotted) + estimate for any
      // audio visit with no metered usage + WhatsApp (count × rate).
      const [{ metered }] = await db
        .select({ metered: sql<number>`coalesce(sum(${aiUsage.costPkr}),0)` })
        .from(aiUsage)
        .where(and(gte(aiUsage.occurredAt, monthStart), scopeExists(aiUsage.clinicId)));
      const [{ sc }] = await db
        .select({ sc: count() })
        .from(visits)
        .where(and(
          isNotNull(visits.audioKey),
          gte(visits.createdAt, monthStart),
          scopeExists(visits.clinicId),
          sql`not exists (select 1 from ${aiUsage} where ${aiUsage.visitId} = ${visits.id})`,
        ));
      const [{ wa }] = await db
        .select({ wa: count() })
        .from(whatsappMessages)
        .where(and(eq(whatsappMessages.direction, "outbound"), isNotNull(whatsappMessages.clinicId), gte(whatsappMessages.createdAt, monthStart), scopeExists(whatsappMessages.clinicId)));
      // Raw provider cost (metered + estimate fallback + WhatsApp), then × the bank
      // international-transaction tax/charges markup (matches computeServingCost).
      const rawCost = num(metered) + (num(sc) * rates.scribeCallCost + num(wa) * rates.whatsappMsgCost) * rates.usdToPkr;
      servingCostThisMonth = Math.round(rawCost * taxMultiplier(rates));
    }
    const grossMarginThisMonth = num(collectedThisMonth) - servingCostThisMonth;

    return {
      totalClinics,
      clinicsByStatus,
      mrr: num(mrr),
      newThisMonth: num(newThisMonth),
      collectedThisMonth: num(collectedThisMonth),
      collectedThisYear: num(collectedThisYear),
      overdueTotal,
      overdueCount: due.length,
      upcomingCount: upcoming.length,
      upcomingTotal,
      servingCostThisMonth,
      grossMarginThisMonth,
      hasCost: withCost,
      topClinics: topRows.map((r) => ({ id: r.id, name: r.name, total: num(r.total) })),
    };
  });
}
