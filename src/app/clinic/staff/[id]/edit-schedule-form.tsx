"use client";

import { useActionState } from "react";
import {
  updateDoctorSchedule,
  type ClinicActionState,
} from "@/app/clinic/actions";
import { DoctorScheduleFields } from "@/app/clinic/doctor-schedule-fields";
import { Button } from "@/core/ui/button";
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

  return (
    <form action={formAction} className="space-y-4">
      <DoctorScheduleFields
        defaultAvailability={availability}
        defaultLimit={dailyLimit}
        defaultFee={fee}
        defaultFlexible={flexibleHours}
      />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save schedule"}
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
