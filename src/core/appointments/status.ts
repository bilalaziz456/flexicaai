/**
 * Appointment statuses — CORE, specialty-agnostic. What the application does with a
 * status: the live-queue flow and the badge styling. The list of codes is DERIVED from
 * the vocabulary (below) and the LABELS come from the database, so neither is written
 * out here. Client-safe (no server-only imports).
 *
 * The live-queue lifecycle a patient moves through on the day:
 *   scheduled/confirmed → arrived (checked in, in the waiting room)
 *   → in_progress (called into the room — the real "now serving")
 *   → completed. `no_show` marks a patient who didn't turn up; `cancelled` a
 *   cancelled visit.
 */

import { APPOINTMENT_STATUS_ROWS, type AppointmentStatusCode } from "@/core/db/vocabulary-seed";

/**
 * The codes, derived from the appointment_status vocabulary rather than restated.
 *
 * The list lives in ONE place — `core/db/vocabulary-seed.ts`, which is also the
 * migration seed and what the start-up check compares the database against. Writing
 * it out a second time here is exactly the drift this whole change removed.
 * `vocabulary-seed` is client-safe (no `server-only`), so this module stays usable
 * from a client component.
 */
export const APPOINTMENT_STATUSES: readonly AppointmentStatusCode[] = APPOINTMENT_STATUS_ROWS.map((r) => r.code);

export type AppointmentStatus = AppointmentStatusCode;

// Labels are NOT here any more. They live in the `appointment_statuses` table and
// reach the UI through core/db/vocabulary-cache.ts (server) or
// core/ui/vocabulary-provider.tsx (client) — see ADR-027. Renaming a status is a row
// update, not a deploy.
//
// The list below stays: the CODES are what the application branches on
// (`nextQueueAction`), and they give the `AppointmentStatus` union its literal type.

/** Badge look per status (shadcn Badge variants). */
export const APPOINTMENT_STATUS_VARIANT: Record<
  AppointmentStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  scheduled: "secondary",
  confirmed: "default",
  arrived: "outline",
  in_progress: "default",
  completed: "default",
  cancelled: "destructive",
  no_show: "destructive",
};

/** Badge variant for a status string (safe for untyped/DB string values). */
export function statusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  return APPOINTMENT_STATUS_VARIANT[status as AppointmentStatus] ?? "secondary";
}

/**
 * The one-tap "advance to the next live state" action for the current status, or
 * null when the appointment is terminal (completed/cancelled/no_show). Drives the
 * primary queue button in the reception UI.
 */
export function nextQueueAction(
  status: string,
): { status: AppointmentStatus; label: string } | null {
  switch (status) {
    case "scheduled":
    case "confirmed":
      return { status: "arrived", label: "Arrived" };
    case "arrived":
      return { status: "in_progress", label: "Call in" };
    case "in_progress":
      return { status: "completed", label: "Complete" };
    default:
      return null;
  }
}
