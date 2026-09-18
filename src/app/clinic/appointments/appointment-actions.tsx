"use client";

import { useTransition } from "react";
import { SelectField } from "@/core/ui/select-field";
import { setAppointmentStatus } from "@/app/clinic/appointments/actions";
import { useVocabularyOptions } from "@/core/ui/vocabulary-provider";
import {
  nextQueueAction,
  type AppointmentStatus,
} from "@/core/appointments/status";

type Status = AppointmentStatus;

/**
 * Appointment status as a themed dropdown (Base UI Select, not a native
 * <select> whose option highlight can't be styled). Set it to any value, which
 * also lets you UNDO (e.g. pick "Scheduled" again after confirming). Applies
 * immediately; patient notices fire only on a real transition (handled
 * server-side).
 */
export function AppointmentActions({
  id,
  status,
}: {
  id: string;
  status: Status;
}) {
  const [pending, startTransition] = useTransition();
  const setStatus = (value: Status) => {
    if (value === status) return;
    startTransition(() => {
      void setAppointmentStatus(id, value);
    });
  };
  // The primary one-tap step through the live queue: Arrived → Call in → Complete.
  // The list AND its labels come from the database (ADR-027), so retiring a status
  // there removes it from this picker with no deploy.
  const statuses = useVocabularyOptions("appointment_statuses");
  const advance = nextQueueAction(status);

  return (
    <div className="flex items-center gap-1.5">
      {advance ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => setStatus(advance.status)}
          className="inline-flex h-9 items-center rounded-lg border border-primary bg-primary px-3.5 text-sm font-medium text-primary-foreground elev-1 transition-colors hover:bg-[color-mix(in_oklch,var(--primary),black_9%)] disabled:pointer-events-none disabled:opacity-50"
        >
          {advance.label}
        </button>
      ) : null}

      <SelectField
        value={status}
        disabled={pending}
        // Re-selecting the current status is a no-op rather than a status write:
        // every change here hits the appointment lifecycle, so the guard stays.
        onValueChange={(next) => {
          if (!next || next === status) return;
          setStatus(next as Status);
        }}
        options={statuses}
        ariaLabel="Appointment status"
        popupClassName="min-w-[9rem]"
      />
    </div>
  );
}
