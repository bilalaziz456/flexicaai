import { Download } from "lucide-react";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/core/auth/user";
import { getClinic } from "@/core/clinics/get-clinic";
import { clinicHasFeature } from "@/core/lib/features";
import { appointmentDoctorScope } from "@/core/appointments/scope";
import { listClinicDoctors } from "@/core/appointments/doctors";
import { listProcedureCatalog } from "@/core/appointments/procedures";
import { getProcedureReport, type ProcedureReportScope } from "@/core/appointments/procedure-report";
import { resolveSalesRange } from "@/core/sales/report";
import { SalesFilters } from "@/core/ui/report-filters";
import { PrintButton } from "@/core/ui/print-button";
import { PrintFileName } from "@/core/ui/print-file-name";
import { BackLink } from "@/core/ui/back-link";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";
import { BRAND_POWERED_BY } from "@/core/lib/brand";
import { ProcedureReportView } from "./report-view";

const PRINT_CSS = `
@media print {
  aside, header, .no-print { display: none !important; }
  main { padding: 0 !important; max-width: none !important; }
}`;

const dayFmt = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

const SCOPES: { value: ProcedureReportScope; label: string }[] = [
  { value: "done", label: "Done (completed visits)" },
  { value: "booked", label: "Booked (not cancelled)" },
  { value: "all", label: "All bookings" },
];

type Search = { period?: string; from?: string; to?: string; doctorId?: string; procedure?: string; scope?: string };

/**
 * Procedures report — which procedures were done (or are booked) over a period, how
 * often, for how many patients and what they billed. Procedures exist only with the
 * `sales` feature; viewing needs `appointments:view`, and a doctor sees only the lines
 * they performed.
 */
export default async function ProceduresReportPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireWorkspace("appointments");
  const { clinicId } = user;
  const clinic = await getClinic(clinicId);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales")) notFound();
  const sp = await searchParams;
  const range = resolveSalesRange(sp.period ?? "30d", sp.from, sp.to, clinic?.createdAt);

  const scope = appointmentDoctorScope(user);
  const [doctorRows, catalog] = await Promise.all([
    scope ? Promise.resolve([]) : listClinicDoctors(clinicId),
    listProcedureCatalog(clinicId),
  ]);
  const doctors = doctorRows.map((d) => ({ id: d.id, name: d.name }));
  const doctorId = scope ?? doctors.find((d) => d.id === sp.doctorId)?.id;
  const procedureId = catalog.find((p) => p.id === sp.procedure)?.id;
  const which = SCOPES.find((s) => s.value === sp.scope)?.value ?? "done";

  const report = await getProcedureReport(clinicId, range, { doctorId, procedureId, scope: which });

  const rangeLabel = range.from === range.to ? `on ${dayFmt(range.from)}` : `${dayFmt(range.from)} – ${dayFmt(range.to)}`;
  const scopeLabel = which === "done" ? "Done" : which === "booked" ? "Booked" : "Booked or cancelled";
  const csv = new URLSearchParams({ kind: "procedures", period: range.period, from: range.from, to: range.to, scope: which });
  if (doctorId && !scope) csv.set("doctorId", doctorId);
  if (procedureId) csv.set("procedure", procedureId);

  return (
    <div className="space-y-6">
      <PrintFileName name="Procedures report" />
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <div className="no-print">
        <BackLink href="/clinic/reports">Reports</BackLink>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Procedures report</h1>
          <p className="text-sm text-muted-foreground">
            {clinic?.name} · {rangeLabel} · {SCOPES.find((s) => s.value === which)?.label}
          </p>
        </div>
        <div className="no-print flex items-center gap-2">
          <a href={`/api/reports/export?${csv.toString()}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            <Download className="size-4" aria-hidden="true" /> CSV
          </a>
          <PrintButton />
        </div>
      </div>

      <div className="no-print">
        <SalesFilters
          period={range.period}
          from={range.from}
          to={range.to}
          doctorId={scope ? "" : (doctorId ?? "")}
          doctors={doctors}
          showDoctor={!scope}
          selects={[
            { param: "scope", label: "Count", value: which, options: SCOPES },
            {
              param: "procedure",
              label: "Procedure",
              value: procedureId ?? "",
              searchable: true,
              options: [
                { value: "", label: "All procedures" },
                ...[...catalog]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((p) => ({ value: p.id, label: p.isActive ? p.name : `${p.name} (retired)` })),
              ],
            },
          ]}
        />
      </div>

      <ProcedureReportView report={report} rangeLabel={rangeLabel} scopeLabel={scopeLabel} />

      <p className="hidden text-center text-xs text-muted-foreground print:block">{BRAND_POWERED_BY}</p>
    </div>
  );
}
