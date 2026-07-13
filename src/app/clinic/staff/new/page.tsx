import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireClinicAdmin } from "@/core/auth/user";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";
import { resourcesForClinic } from "@/core/auth/permissions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { AddStaffForm } from "../add-staff-form";

/** Clinic Admin: add a doctor, receptionist or manager (with permissions). */
export default async function NewStaffPage() {
  const { clinicId } = await requireClinicAdmin();
  const [clinic] = await db
    .select({ featuresEnabled: clinics.featuresEnabled })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
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
            Create a doctor, receptionist or manager. They log in with the
            username and temporary password you set, then choose their own.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddStaffForm resources={permResources} />
        </CardContent>
      </Card>
    </div>
  );
}
