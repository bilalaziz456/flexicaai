import { requireClinicAdmin } from "@/core/auth/user";
import { PatientDetail } from "../patient-detail";

/** Clinic Admin: open a patient — edit details, see appointments, delete. */
export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { clinicId } = await requireClinicAdmin();
  const { id } = await params;
  return (
    <PatientDetail
      clinicId={clinicId}
      patientId={id}
      backHref="/clinic/patients"
      canEdit
      canDelete
    />
  );
}
