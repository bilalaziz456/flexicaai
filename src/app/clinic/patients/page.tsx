import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import {
  PatientsList,
  type PatientsListSearchParams,
} from "./patients-list";

/** Clinic workspace: the patient list (shared component, needs `patients`). */
export default async function ClinicPatientsPage({
  searchParams,
}: {
  searchParams: Promise<PatientsListSearchParams>;
}) {
  const user = await requireWorkspace("patients");
  const sp = await searchParams;
  return (
    <PatientsList
      clinicId={user.clinicId}
      canCreate={can(user, "patients", "create")}
      canBook={can(user, "appointments", "create")}
      bookPath="/clinic/appointments/new"
      listPath="/clinic/patients"
      detailBase="/clinic/patients"
      newHref="/clinic/patients/new"
      searchParams={sp}
    />
  );
}
