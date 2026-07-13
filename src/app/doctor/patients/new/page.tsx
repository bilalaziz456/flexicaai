import { redirect } from "next/navigation";
import { requireRole } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { NewPatientPanel } from "@/app/clinic/patients/new-patient-panel";

/** Doctor with `patients:create`: register a patient. */
export default async function DoctorNewPatientPage() {
  const user = await requireRole("doctor");
  if (!user.clinicId) {
    return <p className="text-sm text-muted-foreground">No clinic linked.</p>;
  }
  if (!can(user, "patients", "create")) redirect("/doctor/patients");
  return <NewPatientPanel backHref="/doctor/patients" />;
}
