import { requireWorkspace } from "@/core/auth/user";
import { NewPatientPanel } from "../new-patient-panel";

/** Clinic workspace: register a patient (needs `patients:create`). */
export default async function NewPatientPage() {
  await requireWorkspace("patients", "create");
  return <NewPatientPanel backHref="/clinic/patients" />;
}
