import Link from "next/link";
import { requireClinicAdmin } from "@/core/auth/user";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { AddPatientForm } from "../add-patient-form";

/** Clinic Admin: register a patient. Redirects back to the list on save. */
export default async function NewPatientPage() {
  await requireClinicAdmin();
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/clinic/patients"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← Back to patients
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Add patient</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New patient</CardTitle>
          <CardDescription>Only the name is required.</CardDescription>
        </CardHeader>
        <CardContent>
          <AddPatientForm />
        </CardContent>
      </Card>
    </div>
  );
}
