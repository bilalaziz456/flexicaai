import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireWorkspace } from "@/core/auth/user";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";
import { ProceduresPanel } from "@/app/reception/procedures-panel";

/** Clinic Admin: manage the procedure catalog (gated by the `sales` feature). */
export default async function ClinicProceduresPage() {
  const { clinicId } = await requireWorkspace("procedures");
  const [clinic] = await db
    .select({
      featuresEnabled: clinics.featuresEnabled,
      modulesEnabled: clinics.modulesEnabled,
    })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales")) notFound();

  return (
    <ProceduresPanel clinicId={clinicId} modulesEnabled={clinic?.modulesEnabled ?? []} />
  );
}
