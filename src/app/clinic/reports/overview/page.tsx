import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireWorkspace } from "@/core/auth/user";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";
import { getSalesDoctors, resolveSalesRange } from "@/core/sales/report";
import { getOverview } from "@/core/finance/overview";
import { getNoShowStats } from "@/core/appointments/no-shows";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { HBarChart } from "@/app/clinic/sales/h-bar-chart";
import { WaterfallChart } from "@/app/clinic/sales/waterfall-chart";
import { SalesFilters } from "@/app/clinic/sales/sales-filters";
import { PrintButton } from "@/app/clinic/shares/payout-ui";
import { BRAND_POWERED_BY } from "@/core/lib/brand";
import { OverviewByDoctorTable, OverviewCashTable, OverviewDiscountsTable } from "./overview-tables";

const money = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 });
const dayFmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

const PRINT_CSS = `
@media print {
  aside, header, .no-print { display: none !important; }
  main { padding: 0 !important; max-width: none !important; }
}`;

/**
 * Overview ("Day report") — the clinic's day (or period) end to end, composed from the
 * existing report cores (docs/overview-report-plan.md). Defaults to today. Performance
 * (collected / discounts / shares / profit) and cash are kept in separate sections.
 * Gated by the `finance` feature + `finance` permission (P&L-level). Print-friendly.
 */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string; doctorId?: string }>;
}) {
  const { clinicId } = await requireWorkspace("finance");
  const [clinic] = await db
    .select({ featuresEnabled: clinics.featuresEnabled, name: clinics.name, createdAt: clinics.createdAt })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  if (!clinicHasFeature(clinic?.featuresEnabled, "finance")) notFound();

  const sp = await searchParams;
  const range = resolveSalesRange(sp.period ?? "today", sp.from, sp.to, clinic?.createdAt);
  const doctorId = sp.doctorId?.trim() || null;

  const [ov, doctors, noShow] = await Promise.all([
    getOverview(clinicId, range, doctorId),
    getSalesDoctors(clinicId),
    getNoShowStats(clinicId, range, doctorId),
  ]);
  const noShowPct = `${(noShow.rate * 100).toFixed(1)}%`;

  const rangeLabel = range.from === range.to ? dayFmt(range.start) : `${dayFmt(range.start)} – ${range.to}`;
  const loss = ov.netProfit < 0;

  // Top summary — performance basis. Clinic-wide profit/expenses drop out when scoped.
  const summary = [
    { title: "Collected", value: money.format(ov.collected), note: "Revenue realised", show: true, tone: "" },
    { title: "Discounts given", value: money.format(ov.discountsApplied), note: ov.discountsPending > 0 ? `+ ${money.format(ov.discountsPending)} pending` : "Applied", show: true, tone: "" },
    { title: "Waivers", value: money.format(ov.waivers), note: "Share waives", show: true, tone: "" },
    { title: "Doctor shares", value: money.format(ov.doctorShares), note: "Earned (net of bearing)", show: true, tone: "" },
    { title: "Expenses", value: money.format(ov.expenses), note: "Incurred", show: !ov.scoped, tone: "" },
    { title: loss ? "Net loss" : "Net profit", value: money.format(Math.abs(ov.netProfit)), note: "Revenue − shares − expenses", show: !ov.scoped, tone: loss ? "text-destructive" : "text-success-text" },
  ].filter((s) => s.show);

  return (
    <div className="space-y-6">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Overview</h1>
          <p className="text-sm text-muted-foreground">
            Your clinic, end to end · <span className="font-medium text-foreground">{rangeLabel}</span>
            {ov.scoped ? " · one doctor" : ""}
          </p>
        </div>
        <div className="no-print">
          <PrintButton />
        </div>
      </div>

      <div className="no-print">
        <SalesFilters period={range.period} from={range.from} to={range.to} doctorId={doctorId ?? ""} doctors={doctors} />
      </div>

      {/* Summary (performance) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {summary.map((s) => (
          <Card key={s.title}>
            <CardHeader>
              <CardDescription>{s.title}</CardDescription>
              <CardTitle className={`text-3xl ${s.tone}`}>{s.value}</CardTitle>
              <CardDescription>{s.note}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      {/* No-shows — attendance for the period (respects the doctor scope). */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">No-shows</CardTitle>
              <CardDescription>
                {noShow.noShow} missed of {noShow.attended} intended visit{noShow.attended === 1 ? "" : "s"}
                {noShow.cancelled > 0 ? ` · ${noShow.cancelled} cancelled` : ""}.
              </CardDescription>
            </div>
            <div className="text-right">
              <div className={`text-3xl font-semibold ${noShow.rate >= 0.15 ? "text-destructive" : ""}`}>{noShowPct}</div>
              <Link href="/clinic/no-shows" className="no-print text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
                Full report →
              </Link>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Money flow: Collected → −Shares → −Expenses → Net profit (clinic-wide only). */}
      {!ov.scoped && ov.collected > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Money flow</CardTitle>
            <CardDescription>How the {money.format(ov.collected)} collected became {money.format(ov.netProfit)} profit.</CardDescription>
          </CardHeader>
          <CardContent>
            <WaterfallChart
              ariaLabel="Collected revenue to net profit"
              steps={[
                { label: "Collected", value: ov.collected, role: "start" },
                // The share deduction is the P&L cost (collected − expenses − profit), net of waivers.
                { label: "− Shares", value: -(ov.collected - ov.expenses - ov.netProfit), role: "deduct" },
                { label: "− Expenses", value: -ov.expenses, role: "deduct" },
                { label: ov.netProfit < 0 ? "Net loss" : "Net profit", value: ov.netProfit, role: "result" },
              ]}
            />
          </CardContent>
        </Card>
      ) : null}

      {/* Per-doctor shares */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Doctor shares</CardTitle>
          <CardDescription>What each doctor earned in this period (net of any discount they bore).</CardDescription>
        </CardHeader>
        <CardContent>
          <OverviewByDoctorTable rows={ov.byDoctor} />
        </CardContent>
      </Card>

      {/* Cash (clinic-wide only) */}
      {!ov.scoped ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cash that moved</CardTitle>
            <CardDescription>
              Money in/out by method (payment date). Separate from realised revenue.{" "}
              <Link href="/clinic/reports/daybook" className="underline underline-offset-4">Day book</Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OverviewCashTable rows={ov.cash.rows} totals={ov.cash.totals} />
          </CardContent>
        </Card>
      ) : null}

      {/* Discounts detail */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Discounts &amp; waivers</CardTitle>
          <CardDescription>
            {money.format(ov.discountsApplied)} applied · clinic bore {money.format(ov.discountClinicBorne)} · doctors bore {money.format(ov.discountDoctorBorne)} · {money.format(ov.waivers)} waived.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OverviewDiscountsTable rows={ov.discounts} />
        </CardContent>
      </Card>

      {/* Sales + Expenses breakdowns */}
      <div className="grid gap-4 lg:grid-cols-2">
        {!ov.scoped ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Collected by doctor</CardTitle>
            </CardHeader>
            <CardContent>
              {ov.salesByDoctor.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sales yet.</p>
              ) : (
                <HBarChart ariaLabel="Collected by doctor" rows={ov.salesByDoctor.map((d) => ({ label: d.name, value: d.net, sublabel: `${d.count} visit${d.count === 1 ? "" : "s"}` }))} />
              )}
            </CardContent>
          </Card>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Billed by procedure</CardTitle>
          </CardHeader>
          <CardContent>
            {ov.salesByProcedure.length === 0 ? (
              <p className="text-sm text-muted-foreground">No procedures yet.</p>
            ) : (
              <HBarChart ariaLabel="Billed by procedure" rows={ov.salesByProcedure.map((p) => ({ label: p.name, value: p.gross, sublabel: `×${p.qty}` }))} />
            )}
          </CardContent>
        </Card>
      </div>

      {!ov.scoped && ov.expenseByCategory.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Expenses by category</CardTitle>
          </CardHeader>
          <CardContent>
            <HBarChart ariaLabel="Expenses by category" rows={ov.expenseByCategory.map((c) => ({ label: c.name, value: c.amount }))} />
          </CardContent>
        </Card>
      ) : null}

      <div className="border-t pt-4 text-center text-xs text-muted-foreground">
        {BRAND_POWERED_BY}
      </div>
    </div>
  );
}
