import { redirect } from "next/navigation";
import { requireRole } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { PatientDetail } from "@/app/clinic/patients/patient-detail";

/** Doctor with the `patients` permission: open a patient. */
export default async function DoctorPatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireRole("doctor");
  if (!user.clinicId) redirect("/login?error=no_access");
  if (!can(user, "patients", "view")) redirect("/doctor");
  const { id } = await params;
  return (
    <PatientDetail
      clinicId={user.clinicId}
      patientId={id}
      backHref="/doctor/patients"
      viewerId={user.id}
      canEdit={can(user, "patients", "edit")}
      canDelete={can(user, "patients", "delete")}
      canBook={can(user, "appointments", "create")}
      bookPath="/doctor/appointments/new"
      canViewClinical={can(user, "clinical", "view")}
      canEditClinical={can(user, "clinical", "edit")}
      canViewPrescriptions={can(user, "prescriptions", "view")}
      canViewAttachments={can(user, "attachments", "view")}
      canUploadAttachments={can(user, "attachments", "create")}
      canDeleteAttachments={can(user, "attachments", "delete")}
      canViewPlans={can(user, "plans", "view")}
      canCreatePlans={can(user, "plans", "create")}
      canEditPlans={can(user, "plans", "edit")}
      canDeletePlans={can(user, "plans", "delete")}
      canViewLab={can(user, "lab", "view")}
      canCreateLab={can(user, "lab", "create")}
      canEditLab={can(user, "lab", "edit")}
      canDeleteLab={can(user, "lab", "delete")}
    />
  );
}
