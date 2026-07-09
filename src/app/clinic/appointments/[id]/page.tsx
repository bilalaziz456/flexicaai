import { requireClinicAdmin } from "@/core/auth/user";
import { AppointmentDetail } from "@/app/reception/appointment-detail";

/** Clinic Admin: open an appointment to manage it. */
export default async function ClinicAppointmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { clinicId } = await requireClinicAdmin();
  const { id } = await params;
  return (
    <AppointmentDetail
      clinicId={clinicId}
      appointmentId={id}
      backHref="/clinic/appointments"
    />
  );
}
