import { requireClinicAdmin } from "@/core/auth/user";
import {
  PatientsList,
  type PatientsListSearchParams,
} from "./patients-list";

/** Clinic Admin: the patient list (shared list component). */
export default async function ClinicPatientsPage({
  searchParams,
}: {
  searchParams: Promise<PatientsListSearchParams>;
}) {
  const { clinicId } = await requireClinicAdmin();
  const sp = await searchParams;
  return (
    <PatientsList
      clinicId={clinicId}
      canCreate
      listPath="/clinic/patients"
      detailBase="/clinic/patients"
      newHref="/clinic/patients/new"
      searchParams={sp}
    />
  );
}
