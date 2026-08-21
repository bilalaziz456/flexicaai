import { notFound } from "next/navigation";
import { getClinic } from "@/core/clinics/get-clinic";

import { Download } from "lucide-react";
import { requireWorkspace } from "@/core/auth/user";
import { clinicHasFeature } from "@/core/lib/features";
import { getSalesDoctors, resolveSalesRange } from "@/core/sales/report";
import { getDiscountsReport } from "@/core/sales/discounts-report";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { DiscountFilters } from "./discounts-filters";
import { DiscountsTable } from "./discounts-table";

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
  const range = resolveSalesRange(sp.period, sp.from, sp.to, clinic?.createdAt);
  const doctorId = sp.doctorId?.trim() || null;
  const borneBy = sp.borneBy?.trim() || "";
  const status = sp.status?.trim() || "";

  const [report, doctors] = await Promise.all([
    getDiscountsReport(clinicId, range, { doctorId, borneBy, status }),
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Discounts</h1>
          <p className="text-sm text-muted-foreground">
            Every discount given: who got it, who bears it, and whether it&apos;s applied.
          </p>
        </div>
        {report.rows.length > 0 ? (
          <a
            href={`/api/finance/export?${exportParams.toString()}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-accent"
          >
            <Download className="size-3.5" aria-hidden="true" /> CSV
          </a>
        ) : null}
      </div>

      <DiscountFilters
        period={range.period}
        from={range.from}
        to={range.to}
        doctorId={doctorId ?? ""}
        borneBy={borneBy}
        status={status}
        doctors={doctors}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { title: "Applied", value: money.format(report.totalApplied), note: "Discounts in effect" },
          { title: "Pending approval", value: money.format(report.totalPending), note: "Not applied yet" },
          { title: "Count", value: String(report.count), note: "Discounted visits" },
        ].map((s) => (
          <Card key={s.title}>
            <CardHeader>
              <CardDescription>{s.title}</CardDescription>
              <CardTitle className="text-3xl">{s.value}</CardTitle>
              <CardDescription>{s.note}</CardDescription>
            </CardHeader>
          </Card>
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
    </div>
  );
}
