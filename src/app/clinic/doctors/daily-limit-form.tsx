"use client";

import { useActionState } from "react";
import { setDoctorDailyLimit, type ReceptionActionState } from "@/app/clinic/appointments/actions";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";

/** Inline editor for a doctor's daily appointment limit (0 = no limit). */
export function DailyLimitForm({
  doctorId,
  limit,
}: {
  doctorId: string;
  limit: number;
}) {
  const action = setDoctorDailyLimit.bind(null, doctorId);
  const [state, formAction, pending] = useActionState<
    ReceptionActionState,
    FormData
  >(action, {});

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <Input
        // Remount on the saved value so the uncontrolled field re-inits cleanly.
        key={limit}
        name="dailyLimit"
        type="number"
        min={0}
        max={500}
        defaultValue={limit}
        aria-label="Daily appointment limit"
        className="h-8 w-24"
      />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      {state.saved ? (
        <span className="text-xs text-emerald-600" role="status">
          Saved.
        </span>
      ) : null}
      {state.error ? (
        <span className="text-xs text-destructive" role="alert">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
