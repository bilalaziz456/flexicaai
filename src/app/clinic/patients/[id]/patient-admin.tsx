"use client";

import { useActionState, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  deletePatient,
  updatePatient,
  type ClinicActionState,
} from "@/app/clinic/actions";
import { Button } from "@/core/ui/button";
import { ConfirmDeleteDialog } from "@/core/ui/confirm-delete-dialog";
import { Input } from "@/core/ui/input";
import { PhoneInput } from "@/core/ui/phone-input";
import { Label } from "@/core/ui/label";
import { Toast } from "@/core/ui/toast";
import { ageFromDob } from "@/core/lib/age";

type PatientData = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  address: string | null;
  reference: string | null;
  dataConsent: boolean;
};

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] pl-2.5 pr-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 select-chevron";

/** Edit a patient's details. */
export function EditPatientForm({ patient }: { patient: PatientData }) {
  const action = updatePatient.bind(null, patient.id);
  const [state, formAction, pending] = useActionState<
    ClinicActionState,
    FormData
  >(action, {});
  const age = ageFromDob(patient.dateOfBirth);
  // Success redirects to the list (flash toast); a failed save pops an error toast.
  // The nonces let an identical message fire again on a repeated save, since
  // useActionState hands back an equal state object each time.
  const [savedNonce, setSavedNonce] = useState(0);
  const [errorNonce, setErrorNonce] = useState(0);
  useEffect(() => {
    if (state.saved) setSavedNonce((n) => n + 1);
    if (state.error) setErrorNonce((n) => n + 1);
  }, [state]);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="fullName">Full name</Label>
          <Input
            key={`n-${patient.fullName}`}
            id="fullName"
            name="fullName"
            defaultValue={patient.fullName}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">WhatsApp / phone</Label>
          <PhoneInput
            key={`p-${patient.phone ?? ""}`}
            id="phone"
            name="phone"
            required
            defaultValue={patient.phone ?? ""}
            placeholder="03450186120"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            key={`e-${patient.email ?? ""}`}
            id="email"
            name="email"
            type="email"
            defaultValue={patient.email ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="age">Age</Label>
          <Input
            key={`age-${age ?? ""}`}
            id="age"
            name="age"
            type="number"
            min={0}
            max={150}
            inputMode="numeric"
            defaultValue={age ?? ""}
            placeholder="e.g. 34"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="gender">Gender</Label>
          <select
            key={`g-${patient.gender ?? ""}`}
            id="gender"
            name="gender"
            defaultValue={patient.gender ?? ""}
            className={selectCls}
          >
            <option value="">—</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="address">Address</Label>
          <Input
            key={`a-${patient.address ?? ""}`}
            id="address"
            name="address"
            defaultValue={patient.address ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="reference">Reference</Label>
          <Input
            key={`r-${patient.reference ?? ""}`}
            id="reference"
            name="reference"
            defaultValue={patient.reference ?? ""}
            placeholder="Referred by (doctor, patient, ad…)"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          name="dataConsent"
          defaultChecked={patient.dataConsent}
          className="size-4 accent-[var(--primary)]"
        />
        Patient consents to their data being stored and used for care.
      </label>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
      <Toast
        message={state.saved ? "Patient updated." : null}
        variant="success"
        token={savedNonce}
      />
      <Toast message={state.error ?? null} variant="error" token={errorNonce} />
    </form>
  );
}

/** Delete the patient (step-up password), then return to the list. */
export function DeletePatientButton({
  patientId,
  name,
}: {
  patientId: string;
  name: string;
}) {
  return (
    <ConfirmDeleteDialog
      triggerLabel="Delete patient"
      triggerVariant="destructive"
      triggerIcon={<Trash2 className="size-4" aria-hidden="true" />}
      title="Delete patient"
      description={`Permanently delete ${name} and all their appointments, visits and recalls. This cannot be undone.`}
      onConfirm={(password) => deletePatient(patientId, password)}
    />
  );
}
