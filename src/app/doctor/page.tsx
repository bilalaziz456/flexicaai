import { requireRole } from "@/core/auth/user";
import { ScribePanel } from "./scribe-panel";

/** Doctor home — voice scribe + recent notes (shared panel). */
export default async function DoctorHome() {
  const user = await requireRole("doctor");
  if (!user.clinicId) {
    return (
      <p className="text-sm text-muted-foreground">
        Your account isn&apos;t linked to a clinic yet. Ask your clinic admin.
      </p>
    );
  }
  return <ScribePanel user={user} clinicId={user.clinicId} />;
}
