"use client";

import { useActionState } from "react";
import { updateClinicSettings, type ClinicActionState } from "@/app/clinic/actions";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";

/** Owner sets their average revenue per visit — feeds "Revenue Recovered". */
export function AvgVisitValueForm({ value }: { value: number }) {
  const [state, formAction, pending] = useActionState<
    ClinicActionState,
    FormData
  >(updateClinicSettings, {});

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor="avgVisitValue" className="text-xs">
          Average visit value (PKR)
        </Label>
        <Input
          // Remount when the saved value changes (after revalidation) so the
          // uncontrolled field re-inits cleanly — Base UI warns if defaultValue
          // changes on an already-initialized uncontrolled control.
          key={value}
          id="avgVisitValue"
          name="avgVisitValue"
          type="number"
          min={0}
          step={100}
          defaultValue={value}
          className="h-8 w-40"
        />
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      {state.error ? (
        <span className="text-xs text-destructive">{state.error}</span>
      ) : null}
      {state.saved ? (
        <span className="text-xs text-emerald-600">Saved.</span>
      ) : null}
    </form>
  );
}
