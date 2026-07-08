"use client";

import { useState } from "react";
import type { ClinicFeature } from "@/core/lib/features";
import {
  updateClinicFeatures,
  type AdminActionState,
} from "@/app/admin/actions";
import { Button } from "@/core/ui/button";
import { Checkbox } from "@/core/ui/checkbox";
import { useActionState } from "react";

/**
 * Super-admin toggles for a clinic's optional platform features (e.g. the
 * Revenue dashboard). Data-driven from CLINIC_FEATURES — add a feature to the
 * core list and it appears here automatically. Checked ids submit as hidden
 * `features` inputs the server action reads from FormData.
 */
export function FeaturesForm({
  clinicId,
  features,
  enabled,
}: {
  clinicId: string;
  features: readonly ClinicFeature[];
  enabled: string[];
}) {
  const action = updateClinicFeatures.bind(null, clinicId);
  const [state, formAction, pending] = useActionState<
    AdminActionState,
    FormData
  >(action, {});
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(enabled),
  );

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        {features.map((f) => (
          <label
            key={f.id}
            className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/50"
          >
            <Checkbox
              className="mt-0.5"
              checked={selected.has(f.id)}
              onCheckedChange={(value) => toggle(f.id, Boolean(value))}
            />
            <div className="space-y-0.5">
              <div className="text-sm font-medium">{f.name}</div>
              <p className="text-xs text-muted-foreground">{f.description}</p>
            </div>
          </label>
        ))}

        {/* Reliable submission: one hidden input per selected feature. */}
        {[...selected].map((id) => (
          <input key={id} type="hidden" name="features" value={id} />
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save features"}
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
