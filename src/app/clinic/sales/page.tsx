import Link from "next/link";
import { getClinic } from "@/core/clinics/get-clinic";
import { notFound } from "next/navigation";

import { Download } from "lucide-react";
import { requireWorkspace } from "@/core/auth/user";
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
import { AreaChart } from "./area-chart";
import { HBarChart } from "@/core/ui/h-bar-chart";
import { SalesFilters } from "@/core/ui/report-filters";

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
  const clinic = await getClinic(clinicId);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales")) notFound();

  const sp = await searchParams;
  const range = resolveSalesRange(sp.period, sp.from, sp.to, clinic?.createdAt);
  const doctorId = sp.doctorId?.trim() || null;

  const [report, doctors] = await Promise.all([
    getSalesReport(clinicId, range, doctorId),
    getSalesDoctors(clinicId),
  ]);

  // Preserve the active filters on the CSV export link.
  const exportParams = new URLSearchParams({ type: "sales", period: range.period });
  if (range.period === "custom") {
    exportParams.set("from", range.from);
    exportParams.set("to", range.to);
  }
  if (doctorId) exportParams.set("doctorId", doctorId);

  const summary = [
    { title: "Collected", value: money.format(report.netTotal), note: "Money received (after discounts)" },
    { title: "Paying visits", value: String(report.count), note: "Completed visits with a payment" },
    { title: "Discounts realized", value: money.format(report.discountTotal), note: "On collected revenue" },
    { title: "Avg per visit", value: money.format(report.avgNet), note: "Collected ÷ paying visits" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Sales</h1>
          <p className="text-sm text-muted-foreground">
            Revenue <strong>collected</strong> from completed visits. Consultation +
            procedures, after discounts. A visit appears here once it&apos;s paid, and what
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
        {report.count > 0 ? (
          <a
            href={`/api/finance/export?${exportParams.toString()}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-accent"
          >
            <Download className="size-3.5" aria-hidden="true" /> CSV
          </a>
        ) : null}
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
            <AreaChart points={report.buckets} ariaLabel="Collected revenue over time" />
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
              <HBarChart
                ariaLabel="Collected revenue by doctor"
                rows={report.byDoctor.map((d) => ({
                  label: d.name,
                  value: d.net,
                  sublabel: `${d.count} visit${d.count === 1 ? "" : "s"}`,
                }))}
              />
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
              <HBarChart
                ariaLabel="Billed value by procedure"
                rows={report.byProcedure.map((p) => ({
                  label: p.name,
                  value: p.gross,
                  sublabel: `×${p.qty}`,
                }))}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
