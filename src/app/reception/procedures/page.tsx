import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireRole } from "@/core/auth/user";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";
import { ProceduresPanel } from "../procedures-panel";

/** Receptionist: manage the procedure catalog (gated by the `sales` feature). */
export default async function ReceptionProceduresPage() {
  const user = await requireRole("receptionist");
  if (!user.clinicId) {
    return <p className="text-sm text-muted-foreground">No clinic linked.</p>;
  }
  const [clinic] = await db
    .select({
      featuresEnabled: clinics.featuresEnabled,
      modulesEnabled: clinics.modulesEnabled,
    })
    .from(clinics)
    .where(eq(clinics.id, user.clinicId))
    .limit(1);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales")) notFound();

  return (
    <ProceduresPanel
      clinicId={user.clinicId}
      modulesEnabled={clinic?.modulesEnabled ?? []}
    />
  );
}
