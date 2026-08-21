import { notFound } from "next/navigation";
import { getClinic } from "@/core/clinics/get-clinic";

import { requireWorkspace } from "@/core/auth/user";
import { clinicHasFeature } from "@/core/lib/features";
import { ProceduresPanel } from "@/app/reception/procedures-panel";

/** Clinic Admin: manage the procedure catalog (gated by the `sales` feature). */
export default async function ClinicProceduresPage() {
  const { clinicId } = await requireWorkspace("procedures");
  const clinic = await getClinic(clinicId);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales")) notFound();

  return (
    <ProceduresPanel clinicId={clinicId} modulesEnabled={clinic?.modulesEnabled ?? []} />
  );
}
