import { requireWorkspace } from "@/core/auth/user";
import { NewAppointmentPanel } from "@/app/clinic/appointments/new-appointment-panel";

/** Clinic workspace: schedule a new appointment (needs `appointments:create`).
 *  `?patientId=` pre-selects a patient (from "Book" on a patient row/detail). */
export default async function ClinicNewAppointmentPage({
  searchParams,
}: {
  searchParams: Promise<{ patientId?: string }>;
}) {
  const user = await requireWorkspace("appointments", "create");
  const { patientId } = await searchParams;
  return (
    <NewAppointmentPanel
      clinicId={user.clinicId}
      backHref="/clinic/appointments"
      preselectedPatientId={patientId}
    />
  );
}
