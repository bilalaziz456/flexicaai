import Link from "next/link";
import { Download } from "lucide-react";
import { requireAdminCapability } from "@/core/auth/user";
import { canAdmin } from "@/core/auth/admin-permissions";
import { getCompanyPnl } from "@/core/admin/pnl";
import { resolveSalesRange } from "@/core/sales/report";
import { ProfitLossChart } from "@/core/ui/charts/profit-loss-chart";
import { LollipopChart } from "@/core/ui/charts/lollipop-chart";
import { StatCard, InsightLine } from "@/core/ui/charts/stat-card";
import { pickInsight, profitCrossingInsight, streakInsight } from "@/core/ui/charts/insights";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/core/ui/table";
import { CostFilters } from "./costs/cost-filters";

const rs = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;
// Signed money, red for a loss — matches the chart's profit colouring.
const signed = (n: number) => `${n < 0 ? "−" : ""}Rs ${Math.abs(n).toLocaleString("en-PK")}`;

/**
 * Owner Finance — company P&L dashboard (Phase 3). "How much are WE earning?":
 * Collected revenue − serving cost − operating expenses = net profit, with gross
 * margin, per-clinic margin, a revenue-vs-cost-vs-profit trend, and a CSV export.
 * MRR/ARR run-rate shown alongside (gated on `revenue:view`). Gated by `pnl:view`.
 */
export default async function CompanyPnlPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const user = await requireAdminCapability("pnl:view");
  const showRevenue = canAdmin(user, "revenue:view");

  const sp = await searchParams;
  const range = resolveSalesRange(sp.period ?? "30d", sp.from, sp.to);
  const pnl = await getCompanyPnl(range);
  const rangeLabel = `${range.from} → ${range.to}`;

  const exportParams = new URLSearchParams({ period: range.period });
  if (range.period === "custom") {
    exportParams.set("from", range.from);
    exportParams.set("to", range.to);
  }

  const hasTrend = pnl.trend.some((b) => b.revenue !== 0 || b.cost !== 0);

  // Both series come from `pnl.trend`, which this page already fetches.
  const profitTrend = pnl.trend.map((b) => b.netProfit);
  const revenueTrend = pnl.trend.map((b) => b.revenue);
  const bucketLabels = pnl.trend.map((b) => b.label);
  const profitInsight = pickInsight(
    profitCrossingInsight(profitTrend),
    streakInsight(profitTrend, { noun: "Net profit" }),
  );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Company P&amp;L</h1>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            How much FlexicaAI earns: collected revenue − serving cost − operating expenses.
          </p>
        </div>
        <Link
          href={`/api/admin/finance/pnl/export?${exportParams.toString()}`}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          prefetch={false}
        >
          <Download className="size-4" aria-hidden="true" /> Export CSV
        </Link>
      </div>

      <CostFilters period={range.period} from={range.from} to={range.to} />

      {/* Headline net profit + the components */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Net profit"
          value={signed(pnl.netProfit)}
          tone={pnl.netProfit < 0 ? "bad" : "good"}
          hint={
            pnl.marginPct !== null ? `${pnl.marginPct}% margin · ${rangeLabel}` : rangeLabel
          }
          trend={profitTrend}
          trendLabels={bucketLabels}
        />
        <StatCard
          label="Collected revenue"
          value={rs(pnl.revenue)}
          trend={revenueTrend}
          trendLabels={bucketLabels}
        />
        {/* Serving cost and opex are not bucketed separately — `PnlBucket.cost`
            combines them — so neither card claims a shape it does not have. */}
        <StatCard label="Serving cost" value={rs(pnl.servingCost)} />
        <StatCard label="Operating expenses" value={rs(pnl.operatingExpenses)} />
      </div>

      {/* Gross margin + run-rate context */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Gross margin"
          value={signed(pnl.grossMargin)}
          hint="Revenue − serving cost"
        />
        {/* Run-rates are a projection of TODAY's subscriptions, not a period total:
            they have no history to draw and no previous window to compare with. */}
        {showRevenue ? (
          <>
            <StatCard label="MRR" value={rs(pnl.mrr)} hint="Run-rate" />
            <StatCard label="ARR" value={rs(pnl.arr)} hint="Run-rate" />
          </>
        ) : null}
      </div>

      {/* Trend */}
      <Card>
        <CardHeader>
          <CardTitle>Profit &amp; loss over time</CardTitle>
          <CardDescription>Net profit per period — above the line is profit, below it is loss. Hover for the revenue and cost behind it ({rangeLabel}).</CardDescription>
        </CardHeader>
        <CardContent>
          {hasTrend ? (
            <>
              <ProfitLossChart
                ariaLabel="Company net profit over time"
                points={pnl.trend.map((b) => ({
                  label: b.label,
                  value: b.netProfit,
                  parts: [
                    { label: "Collected revenue", value: b.revenue },
                    { label: "Total cost", value: -b.cost },
                  ],
                }))}
              />
              {profitInsight ? <InsightLine insight={profitInsight} className="mt-4" /> : null}
            </>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">No revenue or cost in this period yet.</p>
          )}
        </CardContent>
      </Card>

      {/* Per-clinic margin */}
      <Card>
        <CardHeader>
          <CardTitle>Margin by clinic</CardTitle>
          <CardDescription>Collected revenue − serving cost, lowest first. Spot a clinic that costs more than it pays.</CardDescription>
        </CardHeader>
        <CardContent>
          {pnl.perClinic.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No clinic revenue or cost in this period yet.</p>
          ) : (
            <>
            {/* Zero in the middle: "spot a clinic that costs more than it pays" is
                a question about which side of nothing each clinic falls on, and the
                table answered it by making you subtract twenty pairs of numbers.

                This was a revenue-against-cost SCATTER first, which is the textbook
                answer and was wrong here: serving cost runs three orders of
                magnitude below revenue, so every dot lay flat on the axis and the
                two clinics actually losing money were crushed into the origin — the
                exact ones the chart existed to surface. The margin is the answer,
                and it only needs one axis. The table stays for the figures. */}
            <LollipopChart
              diverging
              ariaLabel="Margin by clinic"
              rows={pnl.perClinic.map((c) => ({
                label: c.name,
                value: c.margin,
                sublabel: `${rs(c.revenue)} in · ${rs(c.servingCost)} cost`,
              }))}
            />
            <div className="mt-6" />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Clinic</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Serving cost</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pnl.perClinic.map((c) => (
                  <TableRow key={c.clinicId}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{rs(c.revenue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{rs(c.servingCost)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", c.margin < 0 ? "text-destructive" : "")}>{signed(c.margin)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
