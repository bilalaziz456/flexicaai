import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireWorkspace } from "@/core/auth/user";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";
import { resolveSalesRange } from "@/core/sales/report";
import { getProfitAndLoss } from "@/core/finance/pl";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { SalesChart } from "@/app/clinic/sales/sales-chart";
import { SalesFilters } from "@/app/clinic/sales/sales-filters";

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
    .select({ featuresEnabled: clinics.featuresEnabled })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  if (!clinicHasFeature(clinic?.featuresEnabled, "finance")) notFound();

  const sp = await searchParams;
  const range = resolveSalesRange(sp.period, sp.from, sp.to);
  const pl = await getProfitAndLoss(clinicId, range);

  const loss = pl.netProfit < 0;
  const cards = [
    { title: "Collected revenue", value: money.format(pl.revenue), note: "Money received" },
    { title: "Doctor shares", value: `− ${money.format(pl.doctorShares)}`, note: "Earned on collection" },
    { title: "Expenses", value: `− ${money.format(pl.expenses)}`, note: "Costs incurred" },
    {
      title: loss ? "Net loss" : "Net profit",
      value: money.format(Math.abs(pl.netProfit)),
      note: "Revenue − shares − expenses",
      tone: loss ? "text-destructive" : "text-emerald-600 dark:text-emerald-400",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Profit &amp; Loss</h1>
        <p className="text-sm text-muted-foreground">
          What the clinic kept after doctor shares and expenses — on collected revenue.
        </p>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Collected revenue over time</CardTitle>
        </CardHeader>
        <CardContent>
          {pl.revenue === 0 && pl.expenses === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No activity in this period.
            </p>
          ) : (
            <SalesChart points={pl.revenueBuckets} ariaLabel="Collected revenue over time" />
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[26rem] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-normal">Period</th>
                  <th className="pb-2 text-right font-normal">Revenue</th>
                  <th className="pb-2 text-right font-normal">Costs</th>
                  <th className="pb-2 text-right font-normal">Profit</th>
                </tr>
              </thead>
              <tbody>
                {pl.plBuckets.map((b, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1.5">{b.label}</td>
                    <td className="py-1.5 text-right tabular-nums">{money.format(b.revenue)}</td>
                    <td className="py-1.5 text-right tabular-nums">{money.format(b.expense)}</td>
                    <td className={`py-1.5 text-right font-medium tabular-nums ${b.profit < 0 ? "text-destructive" : ""}`}>
                      {money.format(b.profit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
              <ul className="divide-y text-sm">
                {pl.byExpenseCategory.map((c) => (
                  <li key={c.name} className="flex items-center justify-between py-1.5">
                    <span>{c.name}</span>
                    <span className="font-medium tabular-nums">{money.format(c.amount)}</span>
                  </li>
                ))}
              </ul>
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
              <ul className="divide-y text-sm">
                {pl.byDoctor.map((d) => (
                  <li key={d.name} className="flex items-center justify-between py-1.5">
                    <span>{d.name}</span>
                    <span className="font-medium tabular-nums">{money.format(d.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
