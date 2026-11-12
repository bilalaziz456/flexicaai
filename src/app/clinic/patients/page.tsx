import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { getClinic } from "@/core/clinics/get-clinic";
import { clinicHasFeature } from "@/core/lib/features";
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
  // Money is shown to whoever may open Receivables, in a clinic that bills — the same
  // gate as that report, so the list never reveals a balance the report would refuse.
  const clinic = await getClinic(user.clinicId);
  const showOwed = clinicHasFeature(clinic?.featuresEnabled, "sales") && can(user, "receivables", "view");
  return (
    <PatientsList
      clinicId={user.clinicId}
      canCreate={can(user, "patients", "create")}
      canBook={can(user, "appointments", "create")}
      bookPath="/clinic/appointments/new"
      listPath="/clinic/patients"
      detailBase="/clinic/patients"
      newHref="/clinic/patients/new"
      showOwed={showOwed}
      searchParams={sp}
    />
  );
}
