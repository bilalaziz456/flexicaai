import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireWorkspace } from "@/core/auth/user";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";
import { getSalesDoctors, resolveSalesRange } from "@/core/sales/report";
import { getOverview } from "@/core/finance/overview";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { Badge } from "@/core/ui/badge";
import { HBarChart } from "@/app/clinic/sales/h-bar-chart";
import { WaterfallChart } from "@/app/clinic/sales/waterfall-chart";
import { SalesFilters } from "@/app/clinic/sales/sales-filters";
import { PrintButton } from "@/app/clinic/shares/payout-ui";

const money = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 });
const dayFmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const BORNE: Record<string, string> = { clinic: "Clinic", doctor: "Doctor", split: "Split" };

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
    .select({ featuresEnabled: clinics.featuresEnabled, name: clinics.name })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  if (!clinicHasFeature(clinic?.featuresEnabled, "finance")) notFound();

  const sp = await searchParams;
  const range = resolveSalesRange(sp.period ?? "today", sp.from, sp.to);
  const doctorId = sp.doctorId?.trim() || null;

  const [ov, doctors] = await Promise.all([
    getOverview(clinicId, range, doctorId),
    getSalesDoctors(clinicId),
  ]);

  const rangeLabel = range.from === range.to ? dayFmt(range.start) : `${dayFmt(range.start)} – ${range.to}`;
  const loss = ov.netProfit < 0;

  // Top summary — performance basis. Clinic-wide profit/expenses drop out when scoped.
  const summary = [
    { title: "Collected", value: money.format(ov.collected), note: "Revenue realised", show: true, tone: "" },
    { title: "Discounts given", value: money.format(ov.discountsApplied), note: ov.discountsPending > 0 ? `+ ${money.format(ov.discountsPending)} pending` : "Applied", show: true, tone: "" },
    { title: "Waivers", value: money.format(ov.waivers), note: "Share waives", show: true, tone: "" },
    { title: "Doctor shares", value: money.format(ov.doctorShares), note: "Earned (net of bearing)", show: true, tone: "" },
    { title: "Expenses", value: money.format(ov.expenses), note: "Incurred", show: !ov.scoped, tone: "" },
    { title: loss ? "Net loss" : "Net profit", value: money.format(Math.abs(ov.netProfit)), note: "Revenue − shares − expenses", show: !ov.scoped, tone: loss ? "text-destructive" : "text-emerald-600 dark:text-emerald-400" },
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
          {ov.byDoctor.length === 0 ? (
            <p className="text-sm text-muted-foreground">No doctor shares in this period.</p>
          ) : (
            <>
              <table className="hidden w-full text-sm md:table">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-normal">Doctor</th>
                    <th className="pb-2 text-right font-normal">Visits</th>
                    <th className="pb-2 text-right font-normal">Earned</th>
                    <th className="pb-2 text-right font-normal">Discount borne</th>
                    <th className="pb-2 text-right font-normal">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {ov.byDoctor.map((d) => (
                    <tr key={d.doctorId ?? "none"} className="border-b last:border-0">
                      <td className="py-2">{d.name}</td>
                      <td className="py-2 text-right tabular-nums">{d.count}</td>
                      <td className="py-2 text-right tabular-nums">{money.format(d.grossEarned)}</td>
                      <td className={`py-2 text-right tabular-nums ${d.borne < 0 ? "text-destructive" : ""}`}>{money.format(d.borne)}</td>
                      <td className="py-2 text-right font-medium tabular-nums">{money.format(d.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="space-y-2 md:hidden">
                {ov.byDoctor.map((d) => (
                  <li key={d.doctorId ?? "none"} className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{d.name}</span>
                      <span className="font-medium tabular-nums">{money.format(d.net)}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {d.count} visit{d.count === 1 ? "" : "s"} · earned {money.format(d.grossEarned)} · borne {money.format(d.borne)}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      {/* Cash (clinic-wide only) */}
      {!ov.scoped ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cash that moved</CardTitle>
            <CardDescription>
              Money in/out by method (payment date) — separate from realised revenue.{" "}
              <Link href="/clinic/reports/daybook" className="underline underline-offset-4">Day book</Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {ov.cash.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No cash movement in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[26rem] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="pb-2 font-normal">Method</th>
                      <th className="pb-2 text-right font-normal">Collected</th>
                      <th className="pb-2 text-right font-normal">Refunded</th>
                      <th className="pb-2 text-right font-normal">Expenses</th>
                      <th className="pb-2 text-right font-normal">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ov.cash.rows.map((r) => (
                      <tr key={r.method} className="border-b last:border-0">
                        <td className="py-2 capitalize">{r.method}</td>
                        <td className="py-2 text-right tabular-nums">{money.format(r.collected)}</td>
                        <td className="py-2 text-right tabular-nums">{money.format(r.refunded)}</td>
                        <td className="py-2 text-right tabular-nums">{money.format(r.expenses)}</td>
                        <td className="py-2 text-right font-medium tabular-nums">{money.format(r.net)}</td>
                      </tr>
                    ))}
                    <tr className="border-t font-medium">
                      <td className="py-2">Total</td>
                      <td className="py-2 text-right tabular-nums">{money.format(ov.cash.totals.collected)}</td>
                      <td className="py-2 text-right tabular-nums">{money.format(ov.cash.totals.refunded)}</td>
                      <td className="py-2 text-right tabular-nums">{money.format(ov.cash.totals.expenses)}</td>
                      <td className="py-2 text-right tabular-nums">{money.format(ov.cash.totals.net)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
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
          {ov.discounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No discounts in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-normal">Date</th>
                    <th className="pb-2 font-normal">Patient</th>
                    <th className="pb-2 font-normal">Doctor</th>
                    <th className="pb-2 font-normal">Borne by</th>
                    <th className="pb-2 text-right font-normal">Discount</th>
                  </tr>
                </thead>
                <tbody>
                  {ov.discounts.map((r) => (
                    <tr key={r.appointmentId} className="border-b last:border-0">
                      <td className="py-2">
                        <Link href={`/clinic/appointments/${r.appointmentId}`} className="underline underline-offset-4">{dayFmt(r.scheduledAt)}</Link>
                      </td>
                      <td className="py-2">{r.patientName ?? "—"}</td>
                      <td className="py-2">{r.doctorName ?? "—"}</td>
                      <td className="py-2">
                        {BORNE[r.borneBy] ?? "Clinic"}
                        {r.status === "pending" ? <Badge variant="secondary" className="ml-1.5">Pending</Badge> : null}
                      </td>
                      <td className="py-2 text-right font-medium tabular-nums">{money.format(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
    </div>
  );
}
