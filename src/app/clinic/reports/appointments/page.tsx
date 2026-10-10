import { Download } from "lucide-react";
import { requireWorkspace } from "@/core/auth/user";
import { getClinic } from "@/core/clinics/get-clinic";
import { clinicHasFeature } from "@/core/lib/features";
import { appointmentDoctorScope } from "@/core/appointments/scope";
import { listClinicDoctors } from "@/core/appointments/doctors";
import { listProcedureCatalog } from "@/core/appointments/procedures";
import { getAppointmentReport } from "@/core/appointments/report";
import { resolveSalesRange } from "@/core/sales/report";
import { vocabularyOptions } from "@/core/db/vocabulary-cache";
import { APPOINTMENT_SOURCE_ROWS, APPOINTMENT_STATUS_ROWS } from "@/core/db/vocabulary-seed";
import type { StatusFilter, VisitTypeFilter } from "@/core/appointments/list-filters";
import { SalesFilters } from "@/core/ui/report-filters";
import { PrintButton } from "@/core/ui/print-button";
import { PrintFileName } from "@/core/ui/print-file-name";
import { BackLink } from "@/core/ui/back-link";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";
import { BRAND_POWERED_BY } from "@/core/lib/brand";
import { AppointmentReportView } from "./report-view";

const PRINT_CSS = `
@media print {
  aside, header, .no-print { display: none !important; }
  main { padding: 0 !important; max-width: none !important; }
}`;

const dayFmt = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

type Search = {
  period?: string;
  from?: string;
  to?: string;
  doctorId?: string;
  status?: string;
  type?: string;
  source?: string;
  procedure?: string;
};

/**
 * Appointments report — how many were booked over a period and what became of them,
 * with the filters the appointments list has (doctor, status, type, how it was booked,
 * procedure). Needs `appointments:view`. A doctor sees only their own (the same scope
 * as the appointments list), and gets no Doctor filter.
 */
export default async function AppointmentsReportPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireWorkspace("appointments");
  const { clinicId } = user;
  const clinic = await getClinic(clinicId);
  const sp = await searchParams;
  const range = resolveSalesRange(sp.period ?? "30d", sp.from, sp.to, clinic?.createdAt);

  const scope = appointmentDoctorScope(user);
  const sales = clinicHasFeature(clinic?.featuresEnabled, "sales");
  const [doctorRows, catalog] = await Promise.all([
    scope ? Promise.resolve([]) : listClinicDoctors(clinicId),
    sales ? listProcedureCatalog(clinicId) : Promise.resolve([]),
  ]);
  const doctors = doctorRows.map((d) => ({ id: d.id, name: d.name }));

  // Every value from the URL is checked against what exists, and dropped if not —
  // a stale bookmark shows the wider report rather than an empty one.
  const doctorId = scope ?? doctors.find((d) => d.id === sp.doctorId)?.id;
  const status = APPOINTMENT_STATUS_ROWS.some((r) => r.code === sp.status) ? (sp.status as StatusFilter) : "";
  const type = (["consultation", "procedure", "both"] as const).find((t) => t === sp.type) ?? "";
  const source = APPOINTMENT_SOURCE_ROWS.find((r) => r.code === sp.source)?.code ?? "";
  const procedureId = catalog.find((p) => p.id === sp.procedure)?.id;

  const report = await getAppointmentReport(clinicId, range, {
    doctorId,
    status,
    type: type as VisitTypeFilter,
    source,
    procedureId,
  });

  const rangeLabel = range.from === range.to ? `on ${dayFmt(range.from)}` : `${dayFmt(range.from)} – ${dayFmt(range.to)}`;
  const csv = new URLSearchParams({ kind: "appointments", period: range.period, from: range.from, to: range.to });
  if (doctorId && !scope) csv.set("doctorId", doctorId);
  if (status) csv.set("status", status);
  if (type) csv.set("type", type);
  if (source) csv.set("source", source);
  if (procedureId) csv.set("procedure", procedureId);

  return (
    <div className="space-y-6">
      <PrintFileName name="Appointments report" />
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <div className="no-print">
        <BackLink href="/clinic/reports">Reports</BackLink>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Appointments report</h1>
          <p className="text-sm text-muted-foreground">
            {clinic?.name} · {rangeLabel}
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
            {
              param: "status",
              label: "Status",
              value: status,
              options: [{ value: "", label: "All statuses" }, ...vocabularyOptions("appointment_statuses")],
            },
            {
              param: "type",
              label: "Visit type",
              value: type,
              options: [
                { value: "", label: "Any type" },
                { value: "consultation", label: "Consultation" },
                { value: "procedure", label: "Procedure" },
                { value: "both", label: "Consultation + procedure" },
              ],
            },
            {
              param: "source",
              label: "Booked via",
              value: source,
              options: [{ value: "", label: "Anywhere" }, ...vocabularyOptions("appointment_sources")],
            },
            ...(catalog.length > 0
              ? [
                  {
                    param: "procedure",
                    label: "Procedure",
                    value: procedureId ?? "",
                    searchable: true,
                    options: [
                      { value: "", label: "Any procedure" },
                      ...[...catalog]
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((p) => ({ value: p.id, label: p.isActive ? p.name : `${p.name} (retired)` })),
                    ],
                  },
                ]
              : []),
          ]}
        />
      </div>

      <AppointmentReportView report={report} rangeLabel={rangeLabel} />

      <p className="hidden text-center text-xs text-muted-foreground print:block">{BRAND_POWERED_BY}</p>
    </div>
  );
}
