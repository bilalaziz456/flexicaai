import { requireWorkspace } from "@/core/auth/user";
import { TreatmentEstimate } from "@/app/clinic/patients/treatment-estimate";

/** Clinic workspace: a printable treatment-plan estimate (needs `plans:view`). */
export default async function ClinicEstimatePage({
  params,
}: {
  params: Promise<{ id: string; planId: string }>;
}) {
  const user = await requireWorkspace("plans");
  const { id, planId } = await params;
  return (
    <TreatmentEstimate
      clinicId={user.clinicId}
      patientId={id}
      planId={planId}
      backHref={`/clinic/patients/${id}`}
    />
  );
}
