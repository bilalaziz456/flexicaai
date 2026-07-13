import { redirect } from "next/navigation";
import { requireRole } from "@/core/auth/user";
import { AppointmentDetail } from "@/app/reception/appointment-detail";

/** Receptionist: open an appointment to manage it. */
export default async function ReceptionAppointmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireRole(["receptionist", "manager"]);
  if (!user.clinicId) redirect("/login?error=no_access");
  const { id } = await params;
  return (
    <AppointmentDetail
      clinicId={user.clinicId}
      appointmentId={id}
      backHref="/reception"
    />
  );
}
