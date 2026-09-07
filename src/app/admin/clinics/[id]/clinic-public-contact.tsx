"use client";

import { useActionState, useCallback, useState } from "react";
import { updateClinicPublicContact, type AdminActionState } from "@/app/admin/actions";
import type { ClinicHour } from "@/core/lib/clinic-hours";
import { Button } from "@/core/ui/button";
import { PublicContactFields } from "@/core/ui/public-contact-fields";
import { SavedToast, Toast } from "@/core/ui/toast";

/**
 * The super admin's copy of the clinic's patient-facing address and hours.
 *
 * Exists so onboarding can fill in what the sales call already produced. Without it a
 * new clinic answers neither "where are you?" nor "what are your timings?" over
 * WhatsApp until its admin logs in and fills them in — which can be days, and those
 * are the two questions a new patient asks first.
 *
 * The clinic admin edits the same two columns on their own settings page. Two
 * authorised editors, last write wins; the clinic's own words should generally win,
 * so this is for prefilling rather than for owning the field.
 */
export function ClinicPublicContact({
  clinicId,
  address,
  hours,
  readOnly,
}: {
  clinicId: string;
  address: string | null;
  hours: ClinicHour[] | null;
  readOnly?: boolean;
}) {
  const action = updateClinicPublicContact.bind(null, clinicId);
  const [state, formAction, pending] = useActionState<AdminActionState, FormData>(action, {});
  const [invalid, setInvalid] = useState(false);
  // Stable identity: the child reports validity from an effect, so a fresh function
  // each render would re-run it every render.
  const onInvalidChange = useCallback((v: boolean) => setInvalid(v), []);

  if (readOnly) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          {address ?? "No patient-facing address set."}
        </p>
        <p className="text-muted-foreground">
          {hours && hours.length > 0
            ? `${hours.length} opening ${hours.length === 1 ? "window" : "windows"} set.`
            : "No opening hours set."}
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <PublicContactFields
        address={address}
        hours={hours}
        onInvalidChange={onInvalidChange}
        addressHint="Sent to a patient who asks where the clinic is. Not the billing address above — that one prints on our invoices to them."
      />

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="outline" disabled={pending || invalid}>
          {pending ? "Saving…" : "Save patient-facing details"}
        </Button>
        {invalid ? (
          <span className="text-sm text-destructive">Fix the highlighted times first.</span>
        ) : null}
        {state.error ? <span className="text-sm text-destructive">{state.error}</span> : null}
      </div>
      <SavedToast state={state} message="Patient-facing details saved." />
      <Toast message={state.error ?? null} variant="error" token={state.error ?? ""} />
    </form>
  );
}
