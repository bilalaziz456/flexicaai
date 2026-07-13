import { redirect } from "next/navigation";
import { requireRole } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import {
  AppointmentsList,
  type AppointmentsListSearchParams,
} from "@/app/reception/appointments-list";

/** Doctor with the `appointments` permission: the clinic's appointments list. */
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
    />
  );
}
