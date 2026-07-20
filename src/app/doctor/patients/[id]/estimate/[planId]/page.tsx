import { redirect } from "next/navigation";
import { requireRole } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { TreatmentEstimate } from "@/app/clinic/patients/treatment-estimate";

/** Doctor with `plans:view`: a printable treatment-plan estimate. */
export default async function DoctorEstimatePage({
  params,
}: {
  params: Promise<{ id: string; planId: string }>;
}) {
  const user = await requireRole("doctor");
  if (!user.clinicId) redirect("/login?error=no_access");
  if (!can(user, "plans", "view")) redirect("/doctor");
  const { id, planId } = await params;
  return (
    <TreatmentEstimate
      clinicId={user.clinicId}
      patientId={id}
      planId={planId}
      backHref={`/doctor/patients/${id}`}
    />
  );
}
