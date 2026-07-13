import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { DoctorsPanel } from "@/app/reception/doctors-panel";

/**
 * Clinic workspace: doctor leave (+ daily caps for non-doctors). Needs `leave`.
 * A doctor is self-scoped to their OWN leave; admin/manager/receptionist manage
 * every doctor. The add/remove controls follow the user's leave create/delete.
 */
export default async function ClinicDoctorsPage() {
  const user = await requireWorkspace("leave");
  const selfDoctorId = user.role === "doctor" ? user.id : null;
  return (
    <DoctorsPanel
      clinicId={user.clinicId}
      selfDoctorId={selfDoctorId}
      canCreate={can(user, "leave", "create")}
      canEdit={can(user, "leave", "edit")}
      canDelete={can(user, "leave", "delete")}
    />
  );
}
