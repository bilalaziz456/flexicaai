import Link from "next/link";
import { SPECIALTY_CATALOG } from "@/config/modules";
import { requireAdminCapability } from "@/core/auth/user";
import { CreateClinicForm } from "./create-clinic-form";

/** Super Admin: create a clinic, pick its specialties, create its Clinic Admin. */
export default async function NewClinicPage() {
  await requireAdminCapability("clinics:create");
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← Back to clinics
        </Link>
        <h1 className="mt-2 text-xl font-semibold">New clinic</h1>
      </div>
      <CreateClinicForm catalog={SPECIALTY_CATALOG} />
    </div>
  );
}
