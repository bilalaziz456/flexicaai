import { requireWorkspace } from "@/core/auth/user";
import { NewAppointmentPanel } from "@/app/reception/new-appointment-panel";

/** Clinic workspace: schedule a new appointment (needs `appointments:create`). */
export default async function ClinicNewAppointmentPage() {
  const user = await requireWorkspace("appointments", "create");
  return <NewAppointmentPanel clinicId={user.clinicId} backHref="/clinic/appointments" />;
}
