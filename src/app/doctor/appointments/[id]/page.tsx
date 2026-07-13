import { redirect } from "next/navigation";
import { requireRole } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { AppointmentDetail } from "@/app/reception/appointment-detail";

/** Doctor with the `appointments` permission: open an appointment. */
export default async function DoctorAppointmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireRole("doctor");
  if (!user.clinicId) redirect("/login?error=no_access");
  if (!can(user, "appointments", "view")) redirect("/doctor");
  const { id } = await params;
  return (
    <AppointmentDetail
      clinicId={user.clinicId}
      appointmentId={id}
      backHref="/doctor/appointments"
    />
  );
}
