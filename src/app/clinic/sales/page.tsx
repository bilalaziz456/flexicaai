import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireWorkspace } from "@/core/auth/user";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";
import {
  getSalesDoctors,
  getSalesReport,
  resolveSalesRange,
} from "@/core/sales/report";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { SalesChart } from "./sales-chart";
import { SalesFilters } from "./sales-filters";

const money = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0,
});

/**
 * Clinic Admin Sales report (gated by the super-admin `sales` feature). Revenue
 * comes from the sales ledger — one row per completed appointment, snapshotting
 * consultation fee + procedures − discount. Filterable by period, custom range,
 * and doctor. All clinic-scoped.
 */
export default async function ClinicSalesPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    from?: string;
    to?: string;
    doctorId?: string;
  }>;
}) {
  const { clinicId } = await requireWorkspace("sales");
  const [clinic] = await db
    .select({ featuresEnabled: clinics.featuresEnabled })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales")) notFound();

  const sp = await searchParams;
  const range = resolveSalesRange(sp.period, sp.from, sp.to);
  const doctorId = sp.doctorId?.trim() || null;

  const [report, doctors] = await Promise.all([
    getSalesReport(clinicId, range, doctorId),
    getSalesDoctors(clinicId),
  ]);

  const summary = [
    { title: "Collected", value: money.format(report.netTotal), note: "Money received (after discounts)" },
    { title: "Paying visits", value: String(report.count), note: "Completed visits with a payment" },
    { title: "Discounts realized", value: money.format(report.discountTotal), note: "On collected revenue" },
    { title: "Avg per visit", value: money.format(report.avgNet), note: "Collected ÷ paying visits" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Sales</h1>
        <p className="text-sm text-muted-foreground">
          Revenue <strong>collected</strong> from completed visits — consultation +
          procedures, after discounts. A visit appears here once it&apos;s paid; what
          patients still owe is in{" "}
          <Link href="/clinic/appointments?status=completed&payment=unpaid" className="underline underline-offset-4">
            receivables
          </Link>
          , and the full discounts granted are in{" "}
          <Link href="/clinic/discounts" className="underline underline-offset-4">
            Discounts
          </Link>
          .
        </p>
      </div>

      <SalesFilters
        period={range.period}
        from={range.from}
        to={range.to}
        doctorId={doctorId ?? ""}
        doctors={doctors}
      />

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summary.map((s) => (
          <Card key={s.title}>
            <CardHeader>
              <CardDescription>{s.title}</CardDescription>
              <CardTitle className="text-3xl">{s.value}</CardTitle>
              <CardDescription>{s.note}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      {/* Sales over time */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Collected revenue over time</CardTitle>
          <CardDescription>
            {report.granularity === "hour"
              ? "By hour"
              : report.granularity === "day"
                ? "By day"
                : report.granularity === "week"
                  ? "By week"
                  : "By month"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {report.count === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No paid visits in this period.
            </p>
          ) : (
            <SalesChart points={report.buckets} />
          )}
        </CardContent>
      </Card>

      {/* Breakdowns */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By doctor</CardTitle>
            <CardDescription>Collected revenue by the visit&apos;s doctor.</CardDescription>
          </CardHeader>
          <CardContent>
            {report.byDoctor.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sales yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[18rem] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="pb-2 font-normal">Doctor</th>
                      <th className="pb-2 text-right font-normal">Visits</th>
                      <th className="pb-2 text-right font-normal">Collected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byDoctor.map((d) => (
                      <tr key={d.doctorId ?? "none"} className="border-b last:border-0">
                        <td className="py-2">{d.name}</td>
                        <td className="py-2 text-right tabular-nums">{d.count}</td>
                        <td className="py-2 text-right tabular-nums">{money.format(d.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">By procedure</CardTitle>
            <CardDescription>
              Billed value of procedures performed on paying visits (before collection).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {report.byProcedure.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No procedures on completed appointments yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[18rem] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="pb-2 font-normal">Procedure</th>
                      <th className="pb-2 text-right font-normal">Qty</th>
                      <th className="pb-2 text-right font-normal">Billed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byProcedure.map((p) => (
                      <tr key={p.name} className="border-b last:border-0">
                        <td className="py-2">{p.name}</td>
                        <td className="py-2 text-right tabular-nums">{p.qty}</td>
                        <td className="py-2 text-right tabular-nums">{money.format(p.gross)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
