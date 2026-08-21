import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { appointmentDoctorScope } from "@/core/appointments/scope";
import {
  AppointmentsList,
  type AppointmentsListSearchParams,
} from "@/app/clinic/appointments/appointments-list";

/** Clinic workspace: the appointments list (shared component, permission-gated). */
export default async function ClinicAppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<AppointmentsListSearchParams>;
}) {
  const user = await requireWorkspace("appointments");
  const sp = await searchParams;
  return (
    <AppointmentsList
      clinicId={user.clinicId}
      canCreate={can(user, "appointments", "create")}
      canEdit={can(user, "appointments", "edit")}
      listPath="/clinic/appointments"
      detailBase="/clinic/appointments"
      newHref="/clinic/appointments/new"
      searchParams={sp}
      doctorScope={appointmentDoctorScope(user)}
    />
  );
}
