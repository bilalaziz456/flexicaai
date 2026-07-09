"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import {
  deletePatient,
  updatePatient,
  type ClinicActionState,
} from "@/app/clinic/actions";
import { Button } from "@/core/ui/button";
import { ConfirmDeleteDialog } from "@/core/ui/confirm-delete-dialog";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";

type PatientData = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  address: string | null;
  dataConsent: boolean;
};

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** Edit a patient's details. */
export function EditPatientForm({ patient }: { patient: PatientData }) {
  const action = updatePatient.bind(null, patient.id);
  const [state, formAction, pending] = useActionState<
    ClinicActionState,
    FormData
  >(action, {});

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
          <Input
            key={`p-${patient.phone ?? ""}`}
            id="phone"
            name="phone"
            defaultValue={patient.phone ?? ""}
            placeholder="+92300…"
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
          <Label htmlFor="dateOfBirth">Date of birth</Label>
          <Input
            key={`d-${patient.dateOfBirth ?? ""}`}
            id="dateOfBirth"
            name="dateOfBirth"
            type="date"
            defaultValue={patient.dateOfBirth ?? ""}
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
            <option value="other">Other</option>
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
        {state.saved ? (
          <span className="text-sm text-emerald-600" role="status">
            Saved.
          </span>
        ) : null}
        {state.error ? (
          <span className="text-sm text-destructive" role="alert">
            {state.error}
          </span>
        ) : null}
      </div>
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
