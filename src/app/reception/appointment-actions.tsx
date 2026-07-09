"use client";

import { useTransition } from "react";
import { setAppointmentStatus } from "./actions";

type Status = "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show";

const STATUSES: { value: Status; label: string }[] = [
  { value: "scheduled", label: "Scheduled" },
  { value: "confirmed", label: "Confirmed" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "no_show", label: "No-show" },
];

/**
 * Appointment status as a dropdown — set it to any value, which also lets you
 * UNDO (e.g. pick "Scheduled" again after confirming). Applies immediately;
 * patient notices fire only on a real transition (handled server-side).
 */
export function AppointmentActions({
  id,
  status,
}: {
  id: string;
  status: Status;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      aria-label="Appointment status"
      value={status}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value as Status;
        startTransition(() => {
          void setAppointmentStatus(id, next);
        });
      }}
      className="h-8 rounded-lg border border-input bg-[var(--input-bg)] px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
    >
      {STATUSES.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </select>
  );
}
