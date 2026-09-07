"use client";

import { useActionState, useCallback, useState } from "react";
import type { ClinicHour } from "@/core/lib/clinic-hours";
import { Button } from "@/core/ui/button";
import { PublicContactFields } from "@/core/ui/public-contact-fields";
import { SavedToast, Toast } from "@/core/ui/toast";
import { setClinicPublicContact, type SettingsActionState } from "./actions";

/**
 * The clinic's own public address and opening hours.
 *
 * The FIELDS live in `core/ui/public-contact-fields.tsx` because the super admin edits
 * the same two columns at onboarding (ADR-019 — anything two panels render belongs in
 * core/ui). This file is only the form around them: which action it posts to, and what
 * it says when it saves.
 */
export function PublicContactForm({
  address,
  hours,
}: {
  address: string | null;
  hours: ClinicHour[] | null;
}) {
  const [state, action, pending] = useActionState<SettingsActionState, FormData>(
    setClinicPublicContact,
    {},
  );
  const [invalid, setInvalid] = useState(false);
  // Stable identity: the child calls this from an effect, so a new function each
  // render would re-run it on every render.
  const onInvalidChange = useCallback((v: boolean) => setInvalid(v), []);

  return (
    <form action={action} className="space-y-5">
      <PublicContactFields
        address={address}
        hours={hours}
        onInvalidChange={onInvalidChange}
        addressHint="Sent to a patient who asks where you are. Leave blank and we'll pass the question to your front desk instead."
      />

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="outline" disabled={pending || invalid}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {invalid ? (
          <span className="text-sm text-destructive">Fix the highlighted times first.</span>
        ) : null}
        {state.error ? <span className="text-sm text-destructive">{state.error}</span> : null}
      </div>
      <SavedToast state={state} message="Saved." />
      <Toast message={state.error ?? null} variant="error" token={state.error ?? ""} />
    </form>
  );
}
