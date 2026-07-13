import { requireWorkspace } from "@/core/auth/user";
import { AppointmentDetail } from "@/app/reception/appointment-detail";

/** Clinic workspace: open an appointment to manage it (needs `appointments`). */
export default async function ClinicAppointmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { clinicId } = await requireWorkspace("appointments");
  const { id } = await params;
  return (
    <AppointmentDetail
      clinicId={clinicId}
      appointmentId={id}
      backHref="/clinic/appointments"
    />
  );
}
