import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { Download } from "lucide-react";
import { requireWorkspace } from "@/core/auth/user";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";
import { getSalesDoctors, resolveSalesRange } from "@/core/sales/report";
import { getReceivablesReport } from "@/core/finance/receivables";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { ReceivablesFilters } from "./receivables-filters";

const money = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0,
});
const dayFmt = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/**
 * Receivables report (Finance) — what patients OWE on completed visits, grouped by
 * patient with a per-visit drill-in. Reconciles with the dashboard "Outstanding" KPI
 * (same rule: completed visits, bill − collected). Gated by the `sales` feature +
 * the `receivables` permission (front-desk work — no `finance` feature required).
 */
export default async function ReceivablesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string; doctorId?: string; q?: string }>;
}) {
  const user = await requireWorkspace("receivables");
  const { clinicId } = user;

  const [clinic] = await db
    .select({ featuresEnabled: clinics.featuresEnabled })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales")) notFound();

  const sp = await searchParams;
  const hasRange = Boolean(sp.period) && sp.period !== "all";
  const range = hasRange ? resolveSalesRange(sp.period, sp.from, sp.to) : null;
  const doctorId = sp.doctorId?.trim() || "";
  const q = sp.q?.trim() || "";

  const [report, doctors] = await Promise.all([
    getReceivablesReport(clinicId, {
      doctorId: doctorId || undefined,
      q: q || undefined,
      from: range?.start,
      toExclusive: range?.end,
    }),
    getSalesDoctors(clinicId),
  ]);

  // Preserve the active filters on the CSV export link.
  const exportParams = new URLSearchParams({ type: "receivables" });
  if (hasRange && range) {
    exportParams.set("period", range.period);
    if (range.period === "custom") {
      exportParams.set("from", range.from);
      exportParams.set("to", range.to);
    }
  }
  if (doctorId) exportParams.set("doctorId", doctorId);
  if (q) exportParams.set("q", q);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Receivables</h1>
          <p className="text-sm text-muted-foreground">
            What patients owe on completed visits — this total matches the dashboard&apos;s Outstanding.
          </p>
        </div>
        {report.patients.length > 0 ? (
          <a
            href={`/api/finance/export?${exportParams.toString()}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-accent"
          >
            <Download className="size-3.5" aria-hidden="true" /> CSV
          </a>
        ) : null}
      </div>

      <ReceivablesFilters
        period={range?.period ?? "all"}
        from={range?.from ?? ""}
        to={range?.to ?? ""}
        doctorId={doctorId}
        q={q}
        doctors={doctors}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>Total outstanding</CardDescription>
            <CardTitle className="text-3xl text-amber-600 dark:text-amber-400">
              {money.format(report.total)}
            </CardTitle>
            <CardDescription>Owed on completed visits</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Patients owing</CardDescription>
            <CardTitle className="text-3xl">{report.patientCount}</CardTitle>
            <CardDescription>With an unpaid balance</CardDescription>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By patient</CardTitle>
          <CardDescription>Highest balance first — expand a patient to see the visits.</CardDescription>
        </CardHeader>
        <CardContent>
          {report.patients.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing outstanding. Every completed visit is paid.</p>
          ) : (
            <ul className="divide-y">
              {report.patients.map((p) => (
                <li key={p.patientId}>
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <Link
                          href={`/clinic/patients/${p.patientId}`}
                          className="font-medium underline underline-offset-4"
                        >
                          {p.name}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {p.phone ? `${p.phone} · ` : ""}
                          {p.visits.length} unpaid {p.visits.length === 1 ? "visit" : "visits"} ·
                          {" "}collected {money.format(p.collected)} of {money.format(p.billed)}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                          {money.format(p.outstanding)}
                        </span>
                        <span className="text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true">
                          ›
                        </span>
                      </div>
                    </summary>
                    <div className="overflow-x-auto pb-3">
                      <table className="w-full min-w-[30rem] text-sm">
                        <thead>
                          <tr className="border-y text-left text-xs text-muted-foreground">
                            <th className="py-1.5 font-normal">Date</th>
                            <th className="py-1.5 font-normal">Doctor</th>
                            <th className="py-1.5 text-right font-normal">Bill</th>
                            <th className="py-1.5 text-right font-normal">Collected</th>
                            <th className="py-1.5 text-right font-normal">Outstanding</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.visits.map((v) => (
                            <tr key={v.appointmentId} className="border-b last:border-0">
                              <td className="py-1.5">
                                <Link
                                  href={`/clinic/appointments/${v.appointmentId}`}
                                  className="underline underline-offset-4"
                                >
                                  {dayFmt(v.scheduledAt)}
                                </Link>
                              </td>
                              <td className="py-1.5">{v.doctorName ?? "—"}</td>
                              <td className="py-1.5 text-right tabular-nums">{money.format(v.bill)}</td>
                              <td className="py-1.5 text-right tabular-nums">{money.format(v.collected)}</td>
                              <td className="py-1.5 text-right font-medium tabular-nums text-amber-600 dark:text-amber-400">
                                {money.format(v.outstanding)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
