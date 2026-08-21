import { requireWorkspace } from "@/core/auth/user";
import { AppointmentDetail } from "@/app/clinic/appointments/appointment-detail";
import { FlashToast } from "@/core/ui/toast";

/** Clinic workspace: open an appointment to manage it (needs `appointments`). */
export default async function ClinicAppointmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { clinicId } = await requireWorkspace("appointments");
  const { id } = await params;
  const sp = await searchParams;
  return (
    <>
      <AppointmentDetail
        clinicId={clinicId}
        appointmentId={id}
        backHref="/clinic/appointments"
      />
      {/* Just created → confirm the save (redirected here from the create form so
          staff can collect the fee / print straight away). */}
      <FlashToast message={sp.created ? "Appointment scheduled." : null} />
    </>
  );
}
