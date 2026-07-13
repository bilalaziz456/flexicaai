import { redirect } from "next/navigation";
import { requireRole } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { NewAppointmentPanel } from "../new-appointment-panel";

/** Receptionist / manager: schedule a new appointment. */
export default async function NewAppointmentPage() {
  const user = await requireRole(["receptionist", "manager"]);
  if (!user.clinicId) {
    return <p className="text-sm text-muted-foreground">No clinic linked.</p>;
  }
  // Booking is a "create" — bounce users who can only view.
  if (!can(user, "appointments", "create")) redirect("/reception");
  return <NewAppointmentPanel clinicId={user.clinicId} backHref="/reception" />;
}
