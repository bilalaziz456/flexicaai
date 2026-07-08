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
    <form action={formAction} className="space-y-1.5">
      <Label htmlFor="avgVisitValue" className="text-xs">
        Average visit value (PKR)
      </Label>
      {/* Input, button and status message share one vertically-centred row so
          the button lines up with the field (both h-8) and the message sits
          centred beside them, not hanging at the bottom edge. */}
      <div className="flex flex-wrap items-center gap-3">
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
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {state.error ? (
          <span className="text-xs text-destructive">{state.error}</span>
        ) : null}
        {state.saved ? (
          <span className="text-xs text-emerald-600">Saved.</span>
        ) : null}
      </div>
    </form>
  );
}
