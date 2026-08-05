import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { Download } from "lucide-react";
import { requireWorkspace } from "@/core/auth/user";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";
import Link from "next/link";
import { resolveSalesRange } from "@/core/sales/report";
import { getProfitAndLoss } from "@/core/finance/pl";
import { getOutstandingTotal } from "@/core/finance/receivables";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { MultiBarChart } from "@/app/clinic/sales/multi-bar-chart";
import { HBarChart } from "@/app/clinic/sales/h-bar-chart";
import { SalesFilters } from "@/app/clinic/sales/sales-filters";
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

  const [clinic] = await db
    .select({ featuresEnabled: clinics.featuresEnabled, createdAt: clinics.createdAt })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  if (!clinicHasFeature(clinic?.featuresEnabled, "finance")) notFound();

  const sp = await searchParams;
  const range = resolveSalesRange(sp.period, sp.from, sp.to, clinic?.createdAt);
  const [pl, outstanding] = await Promise.all([
    getProfitAndLoss(clinicId, range),
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
  const cards = [
    { title: "Collected revenue", value: money.format(pl.revenue), note: "Money received" },
    { title: "Doctor shares", value: `− ${money.format(pl.doctorShares)}`, note: "Earned on collection" },
    { title: "Expenses", value: `− ${money.format(pl.expenses)}`, note: "Costs incurred" },
    {
      title: loss ? "Net loss" : "Net profit",
      value: money.format(Math.abs(pl.netProfit)),
      note: "Revenue − shares − expenses",
      tone: loss ? "text-destructive" : "text-success-text",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Profit &amp; Loss</h1>
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
          <Card key={c.title}>
            <CardHeader>
              <CardDescription>{c.title}</CardDescription>
              <CardTitle className={`text-3xl ${c.tone ?? ""}`}>{c.value}</CardTitle>
              <CardDescription>{c.note}</CardDescription>
            </CardHeader>
          </Card>
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
          <CardTitle className="text-base">Revenue, costs &amp; profit over time</CardTitle>
          <CardDescription>
            Collected revenue split into doctor share, expense and net profit (red on a loss).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pl.revenue === 0 && pl.expenses === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No activity in this period.
            </p>
          ) : (
            <MultiBarChart
              ariaLabel="Revenue, doctor share, expense and net profit over time"
              points={pl.plBuckets.map((b) => ({
                label: b.label,
                values: { revenue: b.revenue, share: b.share, expense: b.expense, profit: b.profit },
              }))}
              series={[
                { key: "revenue", label: "Collected revenue", color: "var(--color-chart-1)" },
                { key: "share", label: "Doctor share", color: "var(--color-chart-2)" },
                { key: "expense", label: "Expense", color: "var(--color-chart-4)" },
                { key: "profit", label: "Net profit", color: "var(--color-chart-1)", status: true },
              ]}
            />
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
              <HBarChart ariaLabel="Expenses by category" rows={pl.byExpenseCategory.map((c) => ({ label: c.name, value: c.amount }))} />
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
              <HBarChart ariaLabel="Doctor shares" rows={pl.byDoctor.map((d) => ({ label: d.name, value: d.amount }))} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
