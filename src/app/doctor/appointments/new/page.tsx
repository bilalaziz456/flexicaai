import { redirect } from "next/navigation";
import { requireRole } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { NewAppointmentPanel } from "@/app/reception/new-appointment-panel";

/** Doctor with `appointments:create`: schedule a new appointment. */
export default async function DoctorNewAppointmentPage() {
  const user = await requireRole("doctor");
  if (!user.clinicId) {
    return <p className="text-sm text-muted-foreground">No clinic linked.</p>;
  }
  if (!can(user, "appointments", "create")) redirect("/doctor/appointments");
  return <NewAppointmentPanel clinicId={user.clinicId} backHref="/doctor/appointments" />;
}
