import { notFound } from "next/navigation";
import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { getClinic } from "@/core/clinics/get-clinic";
import { clinicHasFeature } from "@/core/lib/features";
import { NewAppointmentPanel } from "@/app/clinic/appointments/new-appointment-panel";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * New invoice — a visit created WITH its invoice and the payment taken (owner's call,
 * 2026-10-12). The booking form in invoice mode: patient, doctor, date & time,
 * procedures, then the payment. Starts at NOW, computed here on the server so the
 * form's first render is the same on both sides. Needs `billing:create` and
 * `appointments:create` (the action re-checks both).
 */
export default async function NewInvoicePage({
  searchParams,
}: {
  /** `?patientId=` — from "Create invoice" on a patient in the top search. */
  searchParams: Promise<{ patientId?: string }>;
}) {
  const { patientId } = await searchParams;
  const user = await requireWorkspace("billing", "create");
  if (!can(user, "appointments", "create")) notFound();
  const clinic = await getClinic(user.clinicId);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales")) notFound();

  const now = new Date();
  return (
    <NewAppointmentPanel
      clinicId={user.clinicId}
      backHref="/clinic/invoices"
      invoiceMode
      preselectedPatientId={patientId}
      preselectedDate={`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`}
      preselectedTime={`${pad(now.getHours())}:${pad(now.getMinutes() - (now.getMinutes() % 5))}`}
    />
  );
}
