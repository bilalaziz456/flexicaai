import { redirect } from "next/navigation";
import { requireRole } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { appointmentDoctorScope } from "@/core/appointments/scope";
import {
  AppointmentsList,
  type AppointmentsListSearchParams,
} from "@/app/reception/appointments-list";

/** Doctor with the `appointments` permission: THEIR OWN appointments — the list,
 *  the month calendar and the CSV are all scoped by `appointmentDoctorScope`. */
export default async function DoctorAppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<AppointmentsListSearchParams>;
}) {
  const user = await requireRole("doctor");
  if (!user.clinicId) {
    return <p className="text-sm text-muted-foreground">No clinic linked.</p>;
  }
  if (!can(user, "appointments", "view")) redirect("/doctor");
  const sp = await searchParams;
  return (
    <AppointmentsList
      clinicId={user.clinicId}
      canCreate={can(user, "appointments", "create")}
      canEdit={can(user, "appointments", "edit")}
      listPath="/doctor/appointments"
      detailBase="/doctor/appointments"
      newHref="/doctor/appointments/new"
      searchParams={sp}
      doctorScope={appointmentDoctorScope(user)}
    />
  );
}
