import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { PatientDetail } from "../patient-detail";

/** Clinic workspace: open a patient — edit details, see appointments, delete. */
export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireWorkspace("patients");
  const { id } = await params;
  return (
    <PatientDetail
      clinicId={user.clinicId}
      patientId={id}
      backHref="/clinic/patients"
      canEdit={can(user, "patients", "edit")}
      canDelete={can(user, "patients", "delete")}
    />
  );
}
