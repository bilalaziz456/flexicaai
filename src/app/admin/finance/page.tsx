import Link from "next/link";
import { Download } from "lucide-react";
import { requireAdminCapability } from "@/core/auth/user";
import { canAdmin } from "@/core/auth/admin-permissions";
import { getCompanyPnl } from "@/core/admin/pnl";
import { resolveSalesRange } from "@/core/sales/report";
import { MultiBarChart } from "@/app/clinic/sales/multi-bar-chart";
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

  const trendPoints = pnl.trend.map((b) => ({
    label: b.label,
    values: { revenue: b.revenue, cost: b.cost, profit: b.netProfit },
  }));
  const hasTrend = pnl.trend.some((b) => b.revenue !== 0 || b.cost !== 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Company P&amp;L</h1>
          <p className="text-sm text-muted-foreground">
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
        <Card className={pnl.netProfit < 0 ? "border-destructive/40" : "border-emerald-500/40"}>
          <CardHeader className="pb-2"><CardDescription>Net profit ({rangeLabel})</CardDescription></CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-semibold tabular-nums", pnl.netProfit < 0 ? "text-destructive" : "text-success-text")}>
              {signed(pnl.netProfit)}
            </div>
            {pnl.marginPct !== null ? <div className="mt-0.5 text-xs text-muted-foreground">{pnl.marginPct}% margin</div> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Collected revenue</CardDescription></CardHeader>
          <CardContent><div className="text-2xl font-semibold tabular-nums">{rs(pnl.revenue)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Serving cost</CardDescription></CardHeader>
          <CardContent><div className="text-2xl font-semibold tabular-nums">{rs(pnl.servingCost)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Operating expenses</CardDescription></CardHeader>
          <CardContent><div className="text-2xl font-semibold tabular-nums">{rs(pnl.operatingExpenses)}</div></CardContent>
        </Card>
      </div>

      {/* Gross margin + run-rate context */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardDescription>Gross margin (revenue − serving cost)</CardDescription></CardHeader>
          <CardContent><div className="text-xl font-semibold tabular-nums">{signed(pnl.grossMargin)}</div></CardContent>
        </Card>
        {showRevenue ? (
          <>
            <Card>
              <CardHeader className="pb-2"><CardDescription>MRR (run-rate)</CardDescription></CardHeader>
              <CardContent><div className="text-xl font-semibold tabular-nums">{rs(pnl.mrr)}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardDescription>ARR (run-rate)</CardDescription></CardHeader>
              <CardContent><div className="text-xl font-semibold tabular-nums">{rs(pnl.arr)}</div></CardContent>
            </Card>
          </>
        ) : null}
      </div>

      {/* Trend */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue, cost &amp; profit over time</CardTitle>
          <CardDescription>Collected revenue vs total cost (serving + opex), and net profit ({rangeLabel}).</CardDescription>
        </CardHeader>
        <CardContent>
          {hasTrend ? (
            <MultiBarChart
              ariaLabel="Company revenue, cost and net profit over time"
              points={trendPoints}
              series={[
                { key: "revenue", label: "Collected revenue", color: "var(--color-chart-1)" },
                { key: "cost", label: "Total cost", color: "var(--color-chart-4)" },
                { key: "profit", label: "Net profit", color: "var(--color-chart-1)", status: true },
              ]}
            />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">No revenue or cost in this period yet.</p>
          )}
        </CardContent>
      </Card>

      {/* Per-clinic margin */}
      <Card>
        <CardHeader>
          <CardTitle>Margin by clinic</CardTitle>
          <CardDescription>Collected revenue − serving cost, lowest first — spot a clinic that costs more than it pays.</CardDescription>
        </CardHeader>
        <CardContent>
          {pnl.perClinic.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No clinic revenue or cost in this period yet.</p>
          ) : (
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
