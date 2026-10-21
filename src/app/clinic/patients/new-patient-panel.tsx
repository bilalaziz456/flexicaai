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
  canBook = false,
  canInvoice = false,
  nextMrn,
}: {
  backHref: string;
  defaults?: AddPatientDefaults;
  /** Came here intending to book: Save & create appointment is the main button. */
  thenBook?: boolean;
  canBook?: boolean;
  canInvoice?: boolean;
  /** The MRN this patient should get ("FA-100046"), shown before saving. */
  nextMrn?: string | null;
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
          <div className="flex flex-wrap items-start justify-between gap-2">
            <CardTitle>New patient</CardTitle>
            {/* The number the desk will write on the card (owner's call, 2026-10-22).
                Read before saving, so if someone else registers a patient first this
                one gets the next number — hence "on save", not a promise. */}
            {nextMrn ? (
              <div className="text-right">
                <div className="text-sm font-semibold tabular-nums">MRN: {nextMrn}</div>
                <div className="text-xs text-muted-foreground">Given on save</div>
              </div>
            ) : null}
          </div>
          {/* Was "Only the name is required." — stale since the phone became
              mandatory. The form rejects a patient without one (WhatsApp is the whole
              patient channel), so the copy was telling people the opposite of what the
              validation does. */}
          <CardDescription>Name and WhatsApp number are required.</CardDescription>
        </CardHeader>
        <CardContent>
          <AddPatientForm defaults={defaults} thenBook={thenBook} canBook={canBook} canInvoice={canInvoice} />
        </CardContent>
      </Card>
    </div>
  );
}
