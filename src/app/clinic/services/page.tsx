import { notFound } from "next/navigation";
import { getClinic } from "@/core/clinics/get-clinic";
import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { clinicHasFeature } from "@/core/lib/features";
import { listProcedureCatalog } from "@/core/appointments/procedures";
import { ServicesManager } from "@/app/clinic/services/services-manager";

/**
 * The SERVICES price list — room, X-ray, dressing, medicines: anything billed that is
 * not a procedure. Unlike a procedure a service earns no doctor share, carries no
 * clinic offer, and its price can be changed on the bill.
 */
export default async function ClinicServicesPage() {
  const user = await requireWorkspace("services");
  const clinic = await getClinic(user.clinicId);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales")) notFound();

  const list = await listProcedureCatalog(user.clinicId, "service");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Services</h1>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          Other things you charge for — room, X-ray, dressing, medicines. They add to the
          bill like procedures, but earn no doctor share, and the price can be changed on
          the bill. {list.length} service{list.length === 1 ? "" : "s"}.
        </p>
      </div>
      <ServicesManager
        services={list.map((s) => ({ id: s.id, name: s.name, price: s.price, isActive: s.isActive }))}
        perms={{
          create: can(user, "services", "create"),
          edit: can(user, "services", "edit"),
          delete: can(user, "services", "delete"),
        }}
      />
    </div>
  );
}
