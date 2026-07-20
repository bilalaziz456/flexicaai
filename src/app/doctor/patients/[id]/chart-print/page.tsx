import { redirect } from "next/navigation";
import { requireRole } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { ClinicalChartPrint } from "@/app/clinic/patients/clinical-chart-print";

/** Doctor with `clinical:view`: a printable clinical chart. */
export default async function DoctorChartPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireRole("doctor");
  if (!user.clinicId) redirect("/login?error=no_access");
  if (!can(user, "clinical", "view")) redirect("/doctor");
  const { id } = await params;
  return <ClinicalChartPrint clinicId={user.clinicId} patientId={id} backHref={`/doctor/patients/${id}`} />;
}
