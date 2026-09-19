import { BackLink } from "@/core/ui/back-link";
import { SPECIALTY_CATALOG } from "@/config/modules";
import { requireAdminCapability } from "@/core/auth/user";
import { listActiveTeam } from "@/core/admin/assignment";
import { CreateClinicForm } from "./create-clinic-form";

/** Super Admin: create a clinic, pick its specialties, create its Clinic Admin. */
export default async function NewClinicPage() {
  await requireAdminCapability("clinics:create");
  const team = await listActiveTeam();
  return (
    <div className="space-y-6">
      <div>
        <BackLink href="/admin">
          Back to clinics
        </BackLink>
        <h1 className="mt-2 text-xl font-semibold">New clinic</h1>
      </div>
      <CreateClinicForm catalog={SPECIALTY_CATALOG} team={team} />
    </div>
  );
}
