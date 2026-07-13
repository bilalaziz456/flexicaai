import { requireWorkspace } from "@/core/auth/user";
import { DoctorsPanel } from "@/app/reception/doctors-panel";

/** Clinic workspace: doctors — daily caps + leave (needs `leave:view`). */
export default async function ClinicDoctorsPage() {
  const user = await requireWorkspace("leave");
  return <DoctorsPanel clinicId={user.clinicId} />;
}
