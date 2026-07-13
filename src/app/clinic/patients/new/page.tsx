import { requireClinicAdmin } from "@/core/auth/user";
import { NewPatientPanel } from "../new-patient-panel";

/** Clinic Admin: register a patient. Redirects back to the list on save. */
export default async function NewPatientPage() {
  await requireClinicAdmin();
  return <NewPatientPanel backHref="/clinic/patients" />;
}
