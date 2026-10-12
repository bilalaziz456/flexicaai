"use client";

import { ActionMenu } from "@/core/ui/action-menu";
import { useTransition } from "react";
import { Button } from "@/core/ui/button";
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
  compact,
}: {
  id: string;
  status: Status;
  /** The LIST's form: the one next step as a button, and everything else — open the
   *  appointment, change its status — behind a "⋯" menu. The full status dropdown
   *  did not fit a table row once the list grew (owner's report, 2026-10-12). */
  compact?: { openHref: string; label: string };
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

  if (compact) {
    return (
      <div className="flex items-center justify-end gap-1">
        {advance ? (
          <Button type="button" size="sm" disabled={pending} onClick={() => setStatus(advance.status)}>
            {advance.label}
          </Button>
        ) : null}
        <ActionMenu
          label={`More actions for ${compact.label}`}
          sections={[
            { kind: "links", items: [{ label: "Open appointment", href: compact.openHref }] },
            {
              kind: "choice",
              label: "Change status",
              value: status,
              options: statuses,
              disabled: pending,
              onChange: (v) => setStatus(v as Status),
            },
          ]}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {/* The design-system Button at row size, not a hand-rolled one. As a
          full-height primary it made every row as tall as a form field and put the
          loudest colour in the app on every line of the list. */}
      {advance ? (
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() => setStatus(advance.status)}
        >
          {advance.label}
        </Button>
      ) : null}

      <SelectField
        size="sm"
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
