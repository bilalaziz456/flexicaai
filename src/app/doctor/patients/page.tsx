import { redirect } from "next/navigation";
import { requireRole } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import {
  PatientsList,
  type PatientsListSearchParams,
} from "@/app/clinic/patients/patients-list";

/** Doctor with the `patients` permission: the clinic's patient list. */
export default async function DoctorPatientsPage({
  searchParams,
}: {
  searchParams: Promise<PatientsListSearchParams>;
}) {
  const user = await requireRole("doctor");
  if (!user.clinicId) {
    return <p className="text-sm text-muted-foreground">No clinic linked.</p>;
  }
  if (!can(user, "patients", "view")) redirect("/doctor");
  const sp = await searchParams;
  return (
    <PatientsList
      clinicId={user.clinicId}
      canCreate={can(user, "patients", "create")}
      canBook={can(user, "appointments", "create")}
      bookPath="/doctor/appointments/new"
      listPath="/doctor/patients"
      detailBase="/doctor/patients"
      newHref="/doctor/patients/new"
      searchParams={sp}
    />
  );
}
