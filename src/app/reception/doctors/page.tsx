import { redirect } from "next/navigation";
import { requireRole } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { DoctorsPanel } from "../doctors-panel";

/** Receptionist / manager: doctors — daily caps + leave (shared panel). */
export default async function ReceptionDoctorsPage() {
  const user = await requireRole(["receptionist", "manager"]);
  if (!user.clinicId) {
    return (
      <p className="text-sm text-muted-foreground">
        Your account isn&apos;t linked to a clinic yet.
      </p>
    );
  }
  if (!can(user, "leave", "view")) redirect("/reception");
  return <DoctorsPanel clinicId={user.clinicId} />;
}
