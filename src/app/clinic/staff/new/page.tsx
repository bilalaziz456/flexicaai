import Link from "next/link";
import { requireClinicAdmin } from "@/core/auth/user";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { AddStaffForm } from "../add-staff-form";

/** Clinic Admin: add a doctor or receptionist. Redirects back to the list on save. */
export default async function NewStaffPage() {
  await requireClinicAdmin();
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
            Create a doctor or receptionist. They log in with the username and
            temporary password you set, then choose their own.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddStaffForm />
        </CardContent>
      </Card>
    </div>
  );
}
