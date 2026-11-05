import { Fragment } from "react";
import { notFound } from "next/navigation";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/core/ui/table";
import { EmptyState } from "@/core/ui/empty-state";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";
import { getClinic } from "@/core/clinics/get-clinic";

import { Download, PieChart, Receipt, Wallet } from "lucide-react";
import { requireWorkspace } from "@/core/auth/user";
import { clinicHasFeature } from "@/core/lib/features";
import Link from "next/link";
import { precedingRange, resolveSalesRange } from "@/core/sales/report";
import { getProfitAndLoss, listPlExpenseNotes, PL_EXPENSE_NOTES_LIMIT } from "@/core/finance/pl";
import { can } from "@/core/auth/permissions";
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
import { PrintFileName } from "@/core/ui/print-file-name";
import { PageDownloadPdf } from "@/core/ui/page-download-pdf";
import { PlByPeriodTable } from "./pl-tables";

const money = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0,
});
const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

// Same print rules as the other report pages: no app chrome, no screen controls.
const PRINT_CSS = `
@media print {
  aside, header, .no-print { display: none !important; }
  main { padding: 0 !important; max-width: none !important; }
}`;

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
  // Notes say what the money was FOR ("salary – Ayesha"), which is more than the P&L
  // grant implies, so they are shown only to someone who may read the Expenses page.
  const showExpenseNotes = can(user, "expenses", "view");
  const [pl, outstanding, expenseNotes] = await Promise.all([
    // The preceding window comes back from the same aggregation (ADR-031), so the
    // deltas on the cards below cost no extra queries.
    getProfitAndLoss(clinicId, range, { comparedTo: precedingRange(range) }),
    // All-time (point-in-time) receivable — a memo, deliberately NOT in the P&L math.
    getOutstandingTotal(clinicId),
    showExpenseNotes ? listPlExpenseNotes(clinicId, range) : null,
  ]);
  // In the donut's order (largest category first), so the list reads alongside it.
  const notesByCategory = expenseNotes
    ? pl.byExpenseCategory
        .map((c) => ({ name: c.name, items: expenseNotes.byCategory.find((g) => g.name === c.name)?.items ?? [] }))
        .filter((c) => c.items.length > 0)
    : [];

  // Preserve the active period on the CSV export link.
  const exportParams = new URLSearchParams({ type: "pl", period: range.period });
  if (range.period === "custom") {
    exportParams.set("from", range.from);
    exportParams.set("to", range.to);
  }

  // The period filter is a screen control and stays out of the print/PDF, so the
  // period is spelled out under the title — a P&L that does not say WHEN is useless.
  const lastDay = new Date(range.end.getTime() - 1);
  const rangeLabel =
    dayFmt.format(range.start) === dayFmt.format(lastDay)
      ? dayFmt.format(range.start)
      : `${dayFmt.format(range.start)} – ${dayFmt.format(lastDay)}`;

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
      tint: "var(--color-chart-1)",
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
      tint: "var(--color-chart-2)",
    },
    {
      title: "Expenses",
      value: `− ${money.format(pl.expenses)}`,
      note: "Costs incurred",
      trend: expenseTrend,
      current: pl.expenses,
      previous: prev?.expenses,
      higherIsBetter: false,
      tint: "var(--color-warning)",
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
      // Matches the profit-and-loss chart below, which draws this same series green
      // above the zero line and red under it.
      tint: loss ? "var(--color-destructive)" : "var(--color-success)",
    },
  ];

  // One observation, and only when the buckets actually support it.
  const profitInsight = pickInsight(
    profitCrossingInsight(profitTrend, { unit }),
    streakInsight(profitTrend, { noun: "Net profit", unit }),
  );

  return (
    <div className="space-y-6">
      <PrintFileName name={`Profit & Loss ${rangeLabel}`} />
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Profit &amp; Loss</h1>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            What the clinic kept after doctor shares and expenses. On collected revenue ·{" "}
            <span className="whitespace-nowrap font-medium text-foreground">{rangeLabel}</span>
          </p>
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          <a
            href={`/api/finance/export?${exportParams.toString()}`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <Download aria-hidden="true" /> CSV
          </a>
          <PageDownloadPdf />
        </div>
      </div>

      <div className="no-print">
        <SalesFilters
          period={range.period}
          from={range.from}
          to={range.to}
          doctorId=""
          doctors={[]}
          showDoctor={false}
        />
      </div>

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
            trendColor={c.tint}
            tone={c.tone}
            comparisonLabel="vs previous period"
          />
        ))}
      </div>

      {outstanding > 0 ? (
        <p className="rounded-lg border border-dashed well px-3 py-2 text-sm text-muted-foreground">
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
            <EmptyState
              icon={Wallet}
              title="No activity in this period"
              description="Profit and loss is built from completed visits and recorded expenses. Try a wider period."
            />
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
          <CardDescription>Revenue, doctor shares, expenses and profit.</CardDescription>
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
              <EmptyState
                compact
                icon={Receipt}
                title="No expenses in this period"
                description="Costs recorded on the Expenses page are subtracted here."
              />
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
              <EmptyState
                compact
                icon={PieChart}
                title="No doctor shares in this period"
                description="A share is earned when a visit completes and the doctor has a percentage set."
              />
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

      {/* Expense notes — a card of its own, full width, rather than inside the
          category card: there it made that card several times taller than the
          doctor-shares card beside it, which then sat mostly empty. */}
      {notesByCategory.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Expense notes</CardTitle>
            <CardDescription>What the money in each category above was for.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* One table, grouped by category, rather than a column per category:
                categories are rarely the same size (eight notes beside one), and side-by-
                side columns then end at different heights with a hole beside the long
                one. Rows line the dates and amounts up across every category. Bounded
                by PL_EXPENSE_NOTES_LIMIT, so it never needs its own scroll box. */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Note</TableHead>
                  <TableHead className="w-32">Date</TableHead>
                  <TableHead className="hidden w-48 md:table-cell">Vendor</TableHead>
                  <TableHead className="w-28 text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {notesByCategory.map((c) => (
                  <Fragment key={c.name}>
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={4} className="pt-5 pb-1.5">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {c.name}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {c.items.length} {c.items.length === 1 ? "note" : "notes"}
                        </span>
                      </TableCell>
                    </TableRow>
                    {c.items.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-normal break-words">{e.note}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {dayFmt.format(new Date(`${e.incurredOn}T12:00:00`))}
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground md:table-cell">
                          {e.vendor ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{money.format(e.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
            {expenseNotes?.truncated ? (
              <p className="text-xs text-muted-foreground">
                Showing the latest {PL_EXPENSE_NOTES_LIMIT} noted expenses.{" "}
                <Link href="/clinic/expenses" className="underline underline-offset-4">
                  See all on Expenses
                </Link>
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
