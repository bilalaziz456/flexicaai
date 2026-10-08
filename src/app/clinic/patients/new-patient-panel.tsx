import { BackLink } from "@/core/ui/back-link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { AddPatientForm, type AddPatientDefaults } from "./add-patient-form";

/** Shared "add patient" panel. The caller gates on `patients:create`; `backHref`
 *  is where the ← link + post-save land (the panel-specific patients list). */
export function NewPatientPanel({
  backHref,
  defaults,
  thenBook = false,
}: {
  backHref: string;
  defaults?: AddPatientDefaults;
  /** On save, continue to "New appointment" with this patient selected. */
  thenBook?: boolean;
}) {
  return (
    <div className="space-y-6">
      <div>
        <BackLink href={backHref}>
          Back to patients
        </BackLink>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">Add patient</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New patient</CardTitle>
          {/* Was "Only the name is required." — stale since the phone became
              mandatory. The form rejects a patient without one (WhatsApp is the whole
              patient channel), so the copy was telling people the opposite of what the
              validation does. */}
          <CardDescription>Name and WhatsApp number are required.</CardDescription>
        </CardHeader>
        <CardContent>
          <AddPatientForm defaults={defaults} thenBook={thenBook} />
        </CardContent>
      </Card>
    </div>
  );
}
