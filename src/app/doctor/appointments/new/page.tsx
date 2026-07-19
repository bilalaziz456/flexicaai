import { redirect } from "next/navigation";
import { requireRole } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { NewAppointmentPanel } from "@/app/reception/new-appointment-panel";

/** Doctor with `appointments:create`: schedule a new appointment.
 *  `?patientId=` pre-selects a patient (from "Book" on a patient row/detail). */
export default async function DoctorNewAppointmentPage({
  searchParams,
}: {
  searchParams: Promise<{ patientId?: string }>;
}) {
  const user = await requireRole("doctor");
  if (!user.clinicId) {
    return <p className="text-sm text-muted-foreground">No clinic linked.</p>;
  }
  if (!can(user, "appointments", "create")) redirect("/doctor/appointments");
  const { patientId } = await searchParams;
  return (
    <NewAppointmentPanel
      clinicId={user.clinicId}
      backHref="/doctor/appointments"
      preselectedPatientId={patientId}
    />
  );
}
