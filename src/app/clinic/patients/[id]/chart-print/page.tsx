import { requireWorkspace } from "@/core/auth/user";
import { ClinicalChartPrint } from "@/app/clinic/patients/clinical-chart-print";

/** Clinic workspace: a printable clinical chart (needs `clinical:view`). */
export default async function ClinicChartPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireWorkspace("clinical");
  const { id } = await params;
  return <ClinicalChartPrint clinicId={user.clinicId} patientId={id} backHref={`/clinic/patients/${id}`} />;
}
