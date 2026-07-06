"use client";

import { useActionState } from "react";
import { updateClinicName, type AdminActionState } from "@/app/admin/actions";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";

export function RenameClinicForm({
  clinicId,
  name,
}: {
  clinicId: string;
  name: string;
}) {
  const action = updateClinicName.bind(null, clinicId);
  const [state, formAction, pending] = useActionState<
    AdminActionState,
    FormData
  >(action, {});

  return (
    <form action={formAction} className="flex items-start gap-3">
      <div className="flex-1">
        <Input key={name} name="name" defaultValue={name} required />
        {state.error ? (
          <p className="mt-1 text-sm text-destructive" role="alert">
            {state.error}
          </p>
        ) : null}
        {state.saved ? (
          <p className="mt-1 text-sm text-emerald-600" role="status">
            Saved.
          </p>
        ) : null}
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Rename"}
      </Button>
    </form>
  );
}
