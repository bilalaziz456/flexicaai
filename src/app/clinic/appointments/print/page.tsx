import { requireWorkspace } from "@/core/auth/user";
import { PrintFileName } from "@/core/ui/print-file-name";
import { getClinic } from "@/core/clinics/get-clinic";
import { clinicHasFeature } from "@/core/lib/features";
import { BRAND_POWERED_BY } from "@/core/lib/brand";
import { parseListFilters } from "@/core/appointments/list-filters";
import { buildAppointmentConds, listClinicAppointments } from "@/core/appointments/list-query";
import { listClinicDoctors } from "@/core/appointments/doctors";
import { listProcedureCatalog } from "@/core/appointments/procedures";
import { appointmentDoctorScope } from "@/core/appointments/scope";
import { vocabularyLabel } from "@/core/db/vocabulary-cache";
import { AutoPrint } from "@/core/ui/auto-print";
import { BackLink } from "@/core/ui/back-link";
import { PrintButton } from "@/core/ui/print-button";
import type { AppointmentsListSearchParams } from "@/app/clinic/appointments/appointments-list";
import {
  appointmentDoctorLabel,
  appointmentFeeLabel,
  appointmentPayLabel,
  appointmentTypeInfo,
  formatWhen,
} from "@/app/clinic/appointments/row-format";

/**
 * A printed sheet is a record somebody files or pins to a wall, and the longest
 * realistic one is a busy clinic's month. Past this the sheet says so rather than
 * stopping silently at a row nobody would notice was the last.
 */
const PRINT_LIMIT = 1000;

// Always A4 (owner's call): this is an office list, not a receipt, so it does not
// follow the clinic's invoice paper. Drop the panel chrome so only the sheet prints.
const PRINT_CSS = `
@page { size: A4; margin: 12mm; }
@media print {
  aside, header, .no-print { display: none !important; }
  main { padding: 0 !important; max-width: none !important; }
  body { background: #fff !important; }
}`;

/**
 * The appointments list as an A4 sheet — the SAME filters as the screen it was
 * opened from (dates or queue, search, status, type, payment, doctor), but every
 * matching row rather than the current page. Opens the print dialog on load.
 */
export default async function PrintAppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<AppointmentsListSearchParams>;
}) {
  const user = await requireWorkspace("appointments");
  const { clinicId } = user;
  const sp = await searchParams;

  const { fromStr, toStr, q, status, type, doctor, procedure, start, endExclusive } =
    parseListFilters(sp);
  const session = typeof sp.session === "string" ? sp.session : "";
  const clinic = await getClinic(clinicId);
  const billingOn = clinicHasFeature(clinic?.featuresEnabled, "sales");
  const payment = billingOn && typeof sp.payment === "string" ? sp.payment : "";

  // Same rule as the list: a doctor's own scope wins, and a requested doctor must
  // belong to this clinic or the filter is dropped.
  const doctorScope = appointmentDoctorScope(user);
  const doctors = doctorScope ? [] : await listClinicDoctors(clinicId);
  const pickedDoctor = doctors.find((d) => d.id === doctor);
  const doctorId = doctorScope ?? pickedDoctor?.id;
  const pickedProcedure = procedure
    ? (await listProcedureCatalog(clinicId)).find((p) => p.id === procedure)
    : undefined;

  const conds = buildAppointmentConds({
    session,
    start,
    endExclusive,
    q,
    status,
    type,
    payment,
    doctorId,
    procedureId: pickedProcedure?.id,
  });
  const { rows, total } = await listClinicAppointments(
    clinicId,
    conds,
    { offset: 0, limit: PRINT_LIMIT },
    { byQueueNumber: Boolean(session) },
  );

  const range =
    fromStr === toStr
      ? new Date(`${fromStr}T00:00:00`).toLocaleDateString("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : `${fromStr} → ${toStr}`;
  // A printed list with no statement of what it is filtered to is not a record.
  const context = [
    session ? "Doctor's queue" : range,
    pickedDoctor?.name,
    pickedProcedure ? `Procedure: ${pickedProcedure.name}` : null,
    status ? vocabularyLabel("appointment_statuses", status) : null,
    type ? `Type: ${type}` : null,
    payment ? `Payment: ${payment}` : null,
    q ? `Search: “${q}”` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const backParams = new URLSearchParams(
    Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"),
  );

  const th = "border-b-2 border-foreground/70 px-2 py-1.5 text-left font-semibold";
  const td = "border-b border-border px-2 py-1.5 align-top";

  return (
    <div className="mx-auto max-w-[210mm] space-y-4 bg-card p-6 text-sm text-foreground print:p-0">
      <PrintFileName name="Appointments" />
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <AutoPrint />

      <div className="no-print flex items-center justify-between gap-3">
        <BackLink href={`/clinic/appointments?${backParams.toString()}`}>Appointments</BackLink>
        <PrintButton />
      </div>

      <div className="flex items-end justify-between gap-4 border-b pb-3">
        <div>
          <p className="text-base font-semibold">{clinic?.name}</p>
          <h1 className="text-xl font-semibold">Appointments</h1>
          <p className="text-muted-foreground">{context}</p>
        </div>
        <div className="text-right text-muted-foreground">
          <p>
            <span className="font-semibold text-foreground tabular-nums">{total}</span>{" "}
            appointment{total === 1 ? "" : "s"}
          </p>
          <p>Printed {formatWhen(new Date())}</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">
          No appointments match these filters.
        </p>
      ) : (
        <table className="w-full border-collapse text-[0.8rem]">
          <thead>
            <tr>
              <th className={th}>#</th>
              <th className={th}>When</th>
              <th className={th}>Patient</th>
              <th className={th}>Phone</th>
              <th className={th}>Doctor</th>
              <th className={th}>Type</th>
              <th className={`${th} text-right`}>Fee</th>
              <th className={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const fee = appointmentFeeLabel(a);
              const pay = appointmentPayLabel(a, billingOn);
              return (
                // Keep a row whole across a page break.
                <tr key={a.id} className="break-inside-avoid">
                  <td className={`${td} tabular-nums`}>
                    {a.queueNumber != null ? `#${a.queueNumber}` : "—"}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{formatWhen(a.scheduledAt)}</td>
                  <td className={td}>{a.patientName}</td>
                  <td className={`${td} whitespace-nowrap tabular-nums`}>{a.patientPhone ?? "—"}</td>
                  <td className={td}>{appointmentDoctorLabel(a)}</td>
                  <td className={td}>
                    {appointmentTypeInfo(a).label}
                    {a.procedureNames ? (
                      <span className="block text-muted-foreground">{a.procedureNames}</span>
                    ) : null}
                  </td>
                  <td className={`${td} whitespace-nowrap text-right tabular-nums`}>
                    {fee ? fee.net : "—"}
                  </td>
                  <td className={td}>
                    {vocabularyLabel("appointment_statuses", a.status)}
                    {pay ? <span className="block text-muted-foreground">{pay.label}</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {total > rows.length ? (
        <p className="text-muted-foreground">
          Showing the first {rows.length} of {total}. Narrow the dates or filters to print the rest.
        </p>
      ) : null}

      <p className="pt-2 text-center text-xs text-muted-foreground">{BRAND_POWERED_BY}</p>
    </div>
  );
}
