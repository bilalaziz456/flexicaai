"use client";

import { useActionState } from "react";
import type { SpecialtyCatalogEntry } from "@/core/types/module";
import {
  updateClinicModules,
  type AdminActionState,
} from "@/app/admin/actions";
import { SpecialtyCheckboxes } from "@/app/admin/clinics/specialty-checkboxes";
import { Button } from "@/core/ui/button";

export function ModulesForm({
  clinicId,
  catalog,
  enabled,
}: {
  clinicId: string;
  catalog: SpecialtyCatalogEntry[];
  enabled: string[];
}) {
  // Bind the clinic id so useActionState sees the (prevState, formData) shape.
  const action = updateClinicModules.bind(null, clinicId);
  const [state, formAction, pending] = useActionState<
    AdminActionState,
    FormData
  >(action, {});

  return (
    <form action={formAction} className="space-y-4">
      <SpecialtyCheckboxes catalog={catalog} defaultSelected={enabled} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save specialties"}
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
