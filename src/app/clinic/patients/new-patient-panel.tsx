import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { AddPatientForm } from "./add-patient-form";

/** Shared "add patient" panel. The caller gates on `patients:create`; `backHref`
 *  is where the ← link + post-save land (the panel-specific patients list). */
export function NewPatientPanel({ backHref }: { backHref: string }) {
  return (
    <div className="space-y-6">
      <div>
        <Link
          href={backHref}
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
