import Link from "next/link";
import { getClinic } from "@/core/clinics/get-clinic";

import { requireClinicAdmin } from "@/core/auth/user";
import { resourcesForClinic } from "@/core/auth/permissions";
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
  const permResources = resourcesForClinic(clinic?.featuresEnabled);
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/clinic/staff"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← Back to staff
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Add staff</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New staff member</CardTitle>
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
