import { requireRole } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import {
  AppointmentsList,
  type AppointmentsListSearchParams,
} from "./appointments-list";

/** Receptionist / manager: the clinic's appointments (shared list component). */
export default async function ReceptionHome({
  searchParams,
}: {
  searchParams: Promise<AppointmentsListSearchParams>;
}) {
  const user = await requireRole(["receptionist", "manager"]);
  if (!user.clinicId) {
    return (
      <p className="text-sm text-muted-foreground">
        Your account isn&apos;t linked to a clinic yet. Ask your clinic admin.
      </p>
    );
  }
  const sp = await searchParams;
  return (
    <AppointmentsList
      clinicId={user.clinicId}
      canCreate={can(user, "appointments", "create")}
      canEdit={can(user, "appointments", "edit")}
      listPath="/reception"
      detailBase="/reception/appointments"
      newHref="/reception/new"
      searchParams={sp}
    />
  );
}
