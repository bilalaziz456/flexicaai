import { BackLink } from "@/core/ui/back-link";
import { getClinic } from "@/core/clinics/get-clinic";

import { requireClinicAdmin } from "@/core/auth/user";
import { grantableResourcesForClinic } from "@/core/auth/permissions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { AddStaffForm } from "../add-staff-form";

/** Clinic Admin: add any clinic role — including a peer admin (with permissions). */
export default async function NewStaffPage() {
  const { clinicId } = await requireClinicAdmin();
  const clinic = await getClinic(clinicId);
  const permResources = grantableResourcesForClinic(clinic?.featuresEnabled, clinic?.capabilities);
  return (
    <div className="space-y-6">
      <div>
        <BackLink href="/clinic/staff">
          Back to team
        </BackLink>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">Add team member</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New team member</CardTitle>
          <CardDescription>
            Create a doctor, receptionist, manager, or another clinic admin with the
            same access as you. They log in with the username and temporary password
            you set, then choose their own.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddStaffForm resources={permResources} />
        </CardContent>
      </Card>
    </div>
  );
}
