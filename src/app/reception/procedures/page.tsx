import { notFound } from "next/navigation";
import { getClinic } from "@/core/clinics/get-clinic";

import { requireRole } from "@/core/auth/user";
import { clinicHasFeature } from "@/core/lib/features";
import { ProceduresPanel } from "../procedures-panel";

/** Receptionist: manage the procedure catalog (gated by the `sales` feature). */
export default async function ReceptionProceduresPage() {
  const user = await requireRole(["receptionist", "manager"]);
  if (!user.clinicId) {
    return <p className="text-sm text-muted-foreground">No clinic linked.</p>;
  }
  const clinic = await getClinic(user.clinicId);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales")) notFound();

  return (
    <ProceduresPanel
      clinicId={user.clinicId}
      modulesEnabled={clinic?.modulesEnabled ?? []}
    />
  );
}
