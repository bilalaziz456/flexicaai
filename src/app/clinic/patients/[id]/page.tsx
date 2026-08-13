import { eq } from "drizzle-orm";
import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";
import { PatientDetail } from "../patient-detail";

/** Clinic workspace: open a patient — edit details, see appointments, delete. */
export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireWorkspace("patients");
  const { id } = await params;

  // The Finance account card needs the sales feature + billing view access.
  const [clinic] = await db
    .select({ featuresEnabled: clinics.featuresEnabled })
    .from(clinics)
    .where(eq(clinics.id, user.clinicId))
    .limit(1);
  const showFinancials =
    clinicHasFeature(clinic?.featuresEnabled, "sales") && can(user, "billing", "view");

  return (
    <PatientDetail
      clinicId={user.clinicId}
      patientId={id}
      backHref="/clinic/patients"
      viewerId={user.id}
      canEdit={can(user, "patients", "edit")}
      canDelete={can(user, "patients", "delete")}
      canBook={can(user, "appointments", "create")}
      bookPath="/clinic/appointments/new"
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
      showFinancials={showFinancials}
      canRecordPayment={showFinancials && can(user, "billing", "create")}
    />
  );
}
