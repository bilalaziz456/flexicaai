"use client";

import { useTransition } from "react";
import { advanceMyQueue } from "./actions";
import { nextQueueAction } from "@/core/appointments/status";

/**
 * The doctor's one-tap queue control: "Call in" on an arrived patient (→ in_progress)
 * and "Complete" on the one in the room (→ completed). No button on any other state —
 * check-in and cancellations stay with the front desk.
 */
export function QueueAdvanceButton({
  appointmentId,
  status,
}: {
  appointmentId: string;
  status: string;
}) {
  const [pending, startTransition] = useTransition();
  const advance =
    status === "arrived" || status === "in_progress" ? nextQueueAction(status) : null;
  if (!advance) return null;

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => void advanceMyQueue(appointmentId, advance.status))}
      className="inline-flex h-8 shrink-0 items-center rounded-lg border border-primary bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
    >
      {advance.label}
    </button>
  );
}
