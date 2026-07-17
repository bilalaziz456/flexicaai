import "server-only";

import { getSalesReport, type ResolvedRange } from "@/core/sales/report";
import { getDiscountsReport, type DiscountRow } from "@/core/sales/discounts-report";
import { getSharesReport } from "@/core/sales/share-report";
import { getProfitAndLoss } from "@/core/finance/pl";
import { getCashSummary, type CashSummary } from "@/core/finance/daybook";
import { getWaiversTotal } from "@/core/sales/settlement-actions";

/**
 * Overview ("Day report") — CORE. A period-scoped consolidation of every money view,
 * built entirely by COMPOSING the existing tested report cores with the same range, so
 * it reconciles EXACTLY with each standalone report (see docs/overview-report-plan.md).
 * No new money logic here.
 *
 * Two bases, never blended:
 *   - Performance (by VISIT date): collected / discounts / doctor shares / expenses /
 *     net profit — from getSalesReport / getDiscountsReport / getSharesReport /
 *     getProfitAndLoss.
 *   - Cash (by PAYMENT date): getCashSummary — kept in its own field, never summed in.
 *
 * The `doctorId` filter scopes the doctor-aware pieces (sales / shares / discounts /
 * waivers); the clinic-wide P&L (`expenses` / `netProfit`) and `cash` are always
 * clinic-level, so the page hides them when a single doctor is selected (`scoped`).
 */
export type OverviewDoctor = {
  doctorId: string | null;
  name: string;
  grossEarned: number;
  borne: number;
  net: number;
  count: number;
};

export type Overview = {
  scoped: boolean;
  /** Performance basis (by visit date). */
  collected: number; // realised revenue (doctor-scoped when filtered)
  doctorShares: number; // Σ net doctor shares (earned + bearing)
  clinicCut: number | null; // collected − doctorShares (null when scoped)
  discountsApplied: number;
  discountsPending: number;
  discountClinicBorne: number; // Σ of applied discounts the clinic bore
  discountDoctorBorne: number; // Σ of applied discounts doctors bore
  waivers: number;
  expenses: number; // clinic-wide
  netProfit: number; // clinic-wide (revenue − shares − expenses)
  /** Cash basis (by payment date), clinic-wide. */
  cash: CashSummary;
  /** Detail. */
  byDoctor: OverviewDoctor[];
  discounts: DiscountRow[];
  salesByDoctor: { doctorId: string | null; name: string; net: number; count: number }[];
  salesByProcedure: { name: string; gross: number; qty: number }[];
  expenseByCategory: { name: string; amount: number }[];
};

const applied = (s: string) => s === "none" || s === "approved";

export async function getOverview(
  clinicId: string,
  range: ResolvedRange,
  doctorId?: string | null,
): Promise<Overview> {
  const cashRange = { start: range.start, end: range.end };
  const [sales, discounts, shares, pl, cash, waivers] = await Promise.all([
    getSalesReport(clinicId, range, doctorId),
    getDiscountsReport(clinicId, range, { doctorId }),
    getSharesReport(clinicId, range, doctorId),
    getProfitAndLoss(clinicId, range),
    getCashSummary(clinicId, cashRange),
    getWaiversTotal(clinicId, cashRange, doctorId),
  ]);

  const appliedDiscounts = discounts.rows.filter((r) => applied(r.status));

  return {
    scoped: Boolean(doctorId),
    collected: sales.netTotal,
    doctorShares: shares.shareTotal,
    clinicCut: shares.clinicTotal,
    discountsApplied: discounts.totalApplied,
    discountsPending: discounts.totalPending,
    discountClinicBorne: appliedDiscounts.reduce((s, r) => s + r.clinicBears, 0),
    discountDoctorBorne: appliedDiscounts.reduce((s, r) => s + r.doctorBears, 0),
    waivers: waivers.total,
    expenses: pl.expenses,
    netProfit: pl.netProfit,
    cash,
    byDoctor: shares.byDoctor.map((d) => ({
      doctorId: d.doctorId,
      name: d.name,
      grossEarned: d.grossEarned,
      borne: d.borne,
      net: d.earned,
      count: d.count,
    })),
    discounts: discounts.rows,
    salesByDoctor: sales.byDoctor.map((d) => ({ doctorId: d.doctorId, name: d.name, net: d.net, count: d.count })),
    salesByProcedure: sales.byProcedure.map((p) => ({ name: p.name, gross: p.gross, qty: p.qty })),
    expenseByCategory: pl.byExpenseCategory,
  };
}
