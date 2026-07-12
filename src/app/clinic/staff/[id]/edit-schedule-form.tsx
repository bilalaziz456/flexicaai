"use client";

import { useActionState, useEffect, useState } from "react";
import {
  updateDoctorSchedule,
  type ClinicActionState,
} from "@/app/clinic/actions";
import { DoctorScheduleFields } from "@/app/clinic/doctor-schedule-fields";
import { Button } from "@/core/ui/button";
import { Toast } from "@/core/ui/toast";
import type { DayAvailability } from "@/core/lib/availability";

/** Clinic admin: edit a doctor's working hours + daily appointment limit. */
export function EditScheduleForm({
  userId,
  availability,
  dailyLimit,
  fee,
  flexibleHours,
}: {
  userId: string;
  availability: DayAvailability[];
  dailyLimit: number;
  fee: number;
  flexibleHours: boolean;
}) {
  const action = updateDoctorSchedule.bind(null, userId);
  const [state, formAction, pending] = useActionState<
    ClinicActionState,
    FormData
  >(action, {});
  const [valid, setValid] = useState(true);
  // Success redirects to the staff list; a failed save pops an error toast here.
  const [errorNonce, setErrorNonce] = useState(0);
  useEffect(() => {
    if (state.error) setErrorNonce((n) => n + 1);
  }, [state]);

  return (
    <form action={formAction} className="space-y-4">
      <DoctorScheduleFields
        defaultAvailability={availability}
        defaultLimit={dailyLimit}
        defaultFee={fee}
        defaultFlexible={flexibleHours}
        onValidChange={setValid}
      />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || !valid}>
          {pending ? "Saving…" : "Save schedule"}
        </Button>
      </div>
      <Toast message={state.error ?? null} variant="error" token={errorNonce} />
    </form>
  );
}
