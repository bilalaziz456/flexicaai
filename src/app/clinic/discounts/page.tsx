import { notFound } from "next/navigation";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";
import { getClinic } from "@/core/clinics/get-clinic";

import { Download } from "lucide-react";
import { requireWorkspace } from "@/core/auth/user";
import { clinicHasFeature } from "@/core/lib/features";
import { getSalesDoctors, resolveSalesRange } from "@/core/sales/report";
import { getDiscountsReport } from "@/core/sales/discounts-report";
import { getPriceChangesReport } from "@/core/sales/price-changes-report";
import { PriceChangesTable } from "./price-changes-table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { DiscountFilters } from "./discounts-filters";
import { PageDownloadPdf } from "@/core/ui/page-download-pdf";
import { PrintFileName } from "@/core/ui/print-file-name";
import { ReportPeriod, formatReportRange } from "@/core/ui/report-period";
import { DiscountsTable } from "./discounts-table";
import { StatCard } from "@/core/ui/charts/stat-card";

const money = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0,
});

/**
 * Discounts report — every discount given: patient, doctor, amount, who bears it,
 * approval status. Gated by the `discounts` permission + the sales feature.
 */
export default async function DiscountsPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    from?: string;
    to?: string;
    doctorId?: string;
    borneBy?: string;
    status?: string;
  }>;
}) {
  const user = await requireWorkspace("discounts");
  const { clinicId } = user;

  const clinic = await getClinic(clinicId);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales")) notFound();

  const sp = await searchParams;
  // Opens on Today (owner's call, 2026-11-06: every finance page does).
  const range = resolveSalesRange(sp.period || "today", sp.from, sp.to, clinic?.createdAt);
  const doctorId = sp.doctorId?.trim() || null;
  const borneBy = sp.borneBy?.trim() || "";
  const status = sp.status?.trim() || "";

  const [report, priceChanges, doctors] = await Promise.all([
    getDiscountsReport(clinicId, range, { doctorId, borneBy, status }),
    getPriceChangesReport(clinicId, range, { doctorId }),
    getSalesDoctors(clinicId),
  ]);

  // Preserve the active filters on the CSV export link.
  const exportParams = new URLSearchParams({ type: "discounts", period: range.period });
  if (range.period === "custom") {
    exportParams.set("from", range.from);
    exportParams.set("to", range.to);
  }
  if (doctorId) exportParams.set("doctorId", doctorId);
  if (borneBy) exportParams.set("borneBy", borneBy);
  if (status) exportParams.set("status", status);
  const priceExportParams = new URLSearchParams(exportParams);
  priceExportParams.set("type", "price-changes");
  priceExportParams.delete("borneBy");
  priceExportParams.delete("status");

  return (
    <div className="space-y-6">
      <PrintFileName name={`Discounts ${formatReportRange(range.start, range.end)}`} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Discounts</h1>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            Every discount given: who got it, who bears it, and whether it&apos;s applied.
          </p>
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          {report.rows.length > 0 ? (
            <a
              href={`/api/finance/export?${exportParams.toString()}`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              <Download aria-hidden="true" /> CSV
            </a>
          ) : null}
          <PageDownloadPdf />
        </div>
      </div>

      <ReportPeriod
        range={range}
        extra={[doctors.find((d) => d.id === doctorId)?.name, borneBy && `Borne by ${borneBy}`, status && `Status: ${status}`]
          .filter(Boolean)
          .join(" · ")}
      />
      <div className="no-print">
        <DiscountFilters
          period={range.period}
          from={range.from}
          to={range.to}
          doctorId={doctorId ?? ""}
          borneBy={borneBy}
          status={status}
          doctors={doctors}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { title: "Applied", value: money.format(report.totalApplied), note: "Discounts in effect" },
          { title: "Pending approval", value: money.format(report.totalPending), note: "Not applied yet" },
          { title: "Count", value: String(report.count), note: "Discounted visits" },
        ].map((s) => (
          <StatCard key={s.title} label={s.title} value={s.value} hint={s.note} />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Discounts</CardTitle>
        </CardHeader>
        <CardContent>
          <DiscountsTable rows={report.rows} />
        </CardContent>
      </Card>

      {/* A price changed on one bill is not a discount (docs/line-price-plan.md), so it
          has no place in the table above — but a lowered price takes money off a bill
          just the same, so it is listed here, under the same eyes. Not filtered by
          Borne by or Status: a price has neither. */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Price changes</CardTitle>
            <p className="text-sm text-muted-foreground">
              Procedures and services charged at a price other than the list price.
              {priceChanges.count > 0
                ? ` ${priceChanges.count} line${priceChanges.count === 1 ? "" : "s"}: raised ${money.format(priceChanges.raised)}, lowered ${money.format(priceChanges.lowered)}.`
                : ""}
            </p>
          </div>
          {priceChanges.count > 0 ? (
            <a
              href={`/api/finance/export?${priceExportParams.toString()}`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "no-print")}
            >
              <Download aria-hidden="true" /> CSV
            </a>
          ) : null}
        </CardHeader>
        <CardContent>
          <PriceChangesTable rows={priceChanges.rows} />
        </CardContent>
      </Card>
    </div>
  );
}
