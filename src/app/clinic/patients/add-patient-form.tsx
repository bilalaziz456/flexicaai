"use client";

import { useActionState, useEffect, useState } from "react";
import { createPatient, type ClinicActionState } from "@/app/clinic/actions";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { Toast } from "@/core/ui/toast";

export function AddPatientForm() {
  const [state, formAction, pending] = useActionState<
    ClinicActionState,
    FormData
  >(createPatient, {});
  // Success redirects to the list (with a flash toast); a failed add pops an
  // error toast here, re-triggered per attempt.
  const [errorNonce, setErrorNonce] = useState(0);
  useEffect(() => {
    if (state.error) setErrorNonce((n) => n + 1);
  }, [state]);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="fullName">Full name</Label>
          <Input id="fullName" name="fullName" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">WhatsApp / phone</Label>
          <Input id="phone" name="phone" placeholder="+92300…" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="age">Age</Label>
          <Input
            id="age"
            name="age"
            type="number"
            min={0}
            max={150}
            inputMode="numeric"
            placeholder="e.g. 34"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="gender">Gender</Label>
          <select
            id="gender"
            name="gender"
            defaultValue=""
            className="h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] pl-2.5 pr-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 select-chevron"
          >
            <option value="">—</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="address">Address</Label>
          <Input id="address" name="address" />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          name="dataConsent"
          className="size-4 accent-[var(--primary)]"
        />
        Patient consents to their data being stored and used for care.
      </label>

      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add patient"}
      </Button>

      <Toast message={state.error ?? null} variant="error" token={errorNonce} />
    </form>
  );
}
