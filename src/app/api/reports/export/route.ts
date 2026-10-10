import { apiRequireWorkspace } from "@/core/auth/user";
import { getClinic } from "@/core/clinics/get-clinic";
import { clinicHasFeature } from "@/core/lib/features";
import { toCsv } from "@/core/lib/csv";
import { BRAND_POWERED_BY } from "@/core/lib/brand";
import { appointmentDoctorScope } from "@/core/appointments/scope";
import { listClinicDoctors } from "@/core/appointments/doctors";
import { listProcedureCatalog } from "@/core/appointments/procedures";
import { getAppointmentReport } from "@/core/appointments/report";
import { getProcedureReport, type ProcedureReportScope } from "@/core/appointments/procedure-report";
import { resolveSalesRange } from "@/core/sales/report";
import { APPOINTMENT_SOURCE_ROWS, APPOINTMENT_STATUS_ROWS } from "@/core/db/vocabulary-seed";
import type { StatusFilter } from "@/core/appointments/list-filters";

/**
 * GET /api/reports/export?kind=appointments|procedures&… — the CSV behind the
 * Appointments and Procedures reports, for the SAME filters as the screen. The same
 * access as the pages (`appointments:view`; procedures also need the sales feature),
 * and a doctor's download is their own figures — enforced here, never trusted from
 * the link.
 */
export async function GET(req: Request) {
  const auth = await apiRequireWorkspace("appointments", "view");
  if (!auth.ok) return auth.response;
  const { user, clinicId } = auth;
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const clinic = await getClinic(clinicId);
  const range = resolveSalesRange(sp.period ?? "30d", sp.from, sp.to, clinic?.createdAt);
  const scope = appointmentDoctorScope(user);
  const sales = clinicHasFeature(clinic?.featuresEnabled, "sales");
  const [doctors, catalog] = await Promise.all([
    scope ? Promise.resolve([]) : listClinicDoctors(clinicId),
    sales ? listProcedureCatalog(clinicId) : Promise.resolve([]),
  ]);
  const doctorId = scope ?? doctors.find((d) => d.id === sp.doctorId)?.id;
  const procedureId = catalog.find((p) => p.id === sp.procedure)?.id;
  const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "");

  let name: string;
  let csv: string;
  if (sp.kind === "procedures") {
    if (!sales) return new Response("Forbidden", { status: 403 });
    const which = (["done", "booked", "all"] as const).find((s) => s === sp.scope) ?? ("done" as ProcedureReportScope);
    const r = await getProcedureReport(clinicId, range, { doctorId, procedureId, scope: which });
    name = "procedures-report";
    csv = toCsv(
      ["Procedure", "Times", "Quantity", "Patients", "Billed (PKR)", "Clinic offers (PKR)", "Net (PKR)", "Avg per unit (PKR)"],
      [
        ...r.byProcedure.map((p) => [p.name, p.times, p.qty, p.patients, p.gross, p.offers, p.net, p.qty ? Math.round(p.net / p.qty) : ""]),
        ["Total", r.totals.times, r.totals.qty, r.totals.patients, r.totals.gross, r.totals.offers, r.totals.net, r.totals.qty ? Math.round(r.totals.net / r.totals.qty) : ""],
      ],
    );
  } else {
    const status = APPOINTMENT_STATUS_ROWS.some((x) => x.code === sp.status) ? (sp.status as StatusFilter) : "";
    const type = (["consultation", "procedure", "both"] as const).find((t) => t === sp.type) ?? "";
    const source = APPOINTMENT_SOURCE_ROWS.find((x) => x.code === sp.source)?.code ?? "";
    const r = await getAppointmentReport(clinicId, range, { doctorId, status, type, source, procedureId });
    name = "appointments-report";
    csv = toCsv(
      ["Doctor", "Appointments", "Completed", "No-shows", "Cancelled", "No-show rate"],
      [
        ...r.byDoctor.map((d) => [d.name, d.total, d.completed, d.noShow, d.cancelled, pct(d.noShow, d.completed + d.noShow)]),
        ["Total", r.total, r.completed, r.noShow, r.cancelled, pct(r.noShow, r.completed + r.noShow)],
      ],
    );
  }

  const body = "﻿" + csv + `\r\n\r\n${BRAND_POWERED_BY}\r\n`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-${range.from}_to_${range.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
