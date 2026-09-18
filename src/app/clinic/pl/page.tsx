import { notFound } from "next/navigation";
import { getClinic } from "@/core/clinics/get-clinic";

import { Download } from "lucide-react";
import { requireWorkspace } from "@/core/auth/user";
import { clinicHasFeature } from "@/core/lib/features";
import Link from "next/link";
import { precedingRange, resolveSalesRange } from "@/core/sales/report";
import { getProfitAndLoss } from "@/core/finance/pl";
import { getOutstandingTotal } from "@/core/finance/receivables";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { LollipopChart } from "@/core/ui/charts/lollipop-chart";
import { DonutChart } from "@/core/ui/charts/donut-chart";
import { ProfitLossChart } from "@/core/ui/charts/profit-loss-chart";
import { StatCard, InsightLine } from "@/core/ui/charts/stat-card";
import {
  pickInsight,
  profitCrossingInsight,
  streakInsight,
} from "@/core/ui/charts/insights";
import { SalesFilters } from "@/core/ui/report-filters";
import { PlByPeriodTable } from "./pl-tables";

const money = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0,
});

/**
 * Profit & Loss (Finance) — collected revenue − doctor shares − expenses = net
 * profit, over a period, with breakdowns. Gated by the `finance` feature + the
 * `finance` (P&L) permission.
 */
export default async function ProfitLossPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const user = await requireWorkspace("finance");
  const { clinicId } = user;

  const clinic = await getClinic(clinicId);
  if (!clinicHasFeature(clinic?.featuresEnabled, "finance")) notFound();

  const sp = await searchParams;
  const range = resolveSalesRange(sp.period, sp.from, sp.to, clinic?.createdAt);
  const [pl, outstanding] = await Promise.all([
    // The preceding window comes back from the same aggregation (ADR-031), so the
    // deltas on the cards below cost no extra queries.
    getProfitAndLoss(clinicId, range, { comparedTo: precedingRange(range) }),
    // All-time (point-in-time) receivable — a memo, deliberately NOT in the P&L math.
    getOutstandingTotal(clinicId),
  ]);

  // Preserve the active period on the CSV export link.
  const exportParams = new URLSearchParams({ type: "pl", period: range.period });
  if (range.period === "custom") {
    exportParams.set("from", range.from);
    exportParams.set("to", range.to);
  }

  const loss = pl.netProfit < 0;
  // Every card's sparkline is a series the chart below already draws — one figure,
  // one shape, no second query and nothing that can drift out of step.
  const revenueTrend = pl.plBuckets.map((b) => b.revenue);
  const shareTrend = pl.plBuckets.map((b) => b.share);
  const expenseTrend = pl.plBuckets.map((b) => b.expense);
  const profitTrend = pl.plBuckets.map((b) => b.profit);
  const bucketLabels = pl.plBuckets.map((b) => b.label);
  const prev = pl.comparison;
  const unit =
    range.granularity === "month" ? "month" : range.granularity === "week" ? "week" : "day";

  const cards = [
    {
      title: "Collected revenue",
      value: money.format(pl.revenue),
      note: "Money received",
      trend: revenueTrend,
      current: pl.revenue,
      previous: prev?.revenue,
      higherIsBetter: true,
    },
    {
      title: "Doctor shares",
      value: `− ${money.format(pl.doctorShares)}`,
      note: "Earned on collection",
      trend: shareTrend,
      current: pl.doctorShares,
      previous: prev?.doctorShares,
      // A bigger share bill is not a failure — it rises WITH revenue — so it is left
      // uncoloured rather than scored as good or bad in either direction. (This said so
      // for weeks while passing `true`, which painted a rising share bill GREEN beside a
      // rising expense line painted RED — the same direction, the same money out.)
      higherIsBetter: "neutral" as const,
    },
    {
      title: "Expenses",
      value: `− ${money.format(pl.expenses)}`,
      note: "Costs incurred",
      trend: expenseTrend,
      current: pl.expenses,
      previous: prev?.expenses,
      higherIsBetter: false,
    },
    {
      title: loss ? "Net loss" : "Net profit",
      value: money.format(Math.abs(pl.netProfit)),
      note: "Revenue − shares − expenses",
      trend: profitTrend,
      current: pl.netProfit,
      previous: prev?.netProfit,
      higherIsBetter: true,
      tone: (loss ? "bad" : "good") as "bad" | "good",
    },
  ];

  // One observation, and only when the buckets actually support it.
  const profitInsight = pickInsight(
    profitCrossingInsight(profitTrend, { unit }),
    streakInsight(profitTrend, { noun: "Net profit", unit }),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Profit &amp; Loss</h1>
          <p className="text-sm text-muted-foreground">
            What the clinic kept after doctor shares and expenses. On collected revenue.
          </p>
        </div>
        <a
          href={`/api/finance/export?${exportParams.toString()}`}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-accent"
        >
          <Download className="size-3.5" aria-hidden="true" /> CSV
        </a>
      </div>

      <SalesFilters
        period={range.period}
        from={range.from}
        to={range.to}
        doctorId=""
        doctors={[]}
        showDoctor={false}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <StatCard
            key={c.title}
            label={c.title}
            value={c.value}
            hint={c.note}
            trend={c.trend}
            trendLabels={bucketLabels}
            current={c.current}
            previous={c.previous}
            higherIsBetter={c.higherIsBetter}
            tone={c.tone}
            comparisonLabel="vs previous period"
          />
        ))}
      </div>

      {outstanding > 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
          Memo: <span className="font-medium text-foreground">{money.format(outstanding)}</span>{" "}
          outstanding from patients is <strong>not</strong> in this profit. It counts only
          when collected.{" "}
          <Link href="/clinic/receivables" className="underline underline-offset-4">
            View receivables
          </Link>
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profit &amp; loss over time</CardTitle>
          <CardDescription>
            What was left after doctor shares and expenses. Above the line is profit, below
            it is loss — hover a period for the figures behind it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pl.revenue === 0 && pl.expenses === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No activity in this period.
            </p>
          ) : (
            <>
              <ProfitLossChart
                ariaLabel="Net profit or loss over time"
                points={pl.plBuckets.map((b) => ({
                  label: b.label,
                  value: b.profit,
                  parts: [
                    { label: "Collected revenue", value: b.revenue },
                    { label: "Doctor share", value: -b.share },
                    { label: "Expenses", value: -b.expense },
                  ],
                }))}
              />
              {profitInsight ? <InsightLine insight={profitInsight} className="mt-4" /> : null}
            </>
          )}
        </CardContent>
      </Card>

      {/* Per-period P&L */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">By period</CardTitle>
          <CardDescription>Revenue, costs (shares + expenses) and profit.</CardDescription>
        </CardHeader>
        <CardContent>
          <PlByPeriodTable rows={pl.plBuckets} />
        </CardContent>
      </Card>

      {/* Breakdowns */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Expenses by category</CardTitle>
          </CardHeader>
          <CardContent>
            {pl.byExpenseCategory.length === 0 ? (
              <p className="text-sm text-muted-foreground">No expenses in this period.</p>
            ) : (
              /* Composition, not ranking: these categories ARE the expense total, so
                 the question is what share each takes of it. */
              <DonutChart
                ariaLabel="Expenses by category"
                centerLabel="Expenses"
                slices={pl.byExpenseCategory.map((c) => ({ label: c.name, value: c.amount }))}
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Doctor shares</CardTitle>
          </CardHeader>
          <CardContent>
            {pl.byDoctor.length === 0 ? (
              <p className="text-sm text-muted-foreground">No doctor shares in this period.</p>
            ) : (
              <LollipopChart
                ariaLabel="Doctor shares"
                showShare
                rows={pl.byDoctor.map((d) => ({ label: d.name, value: d.amount }))}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
