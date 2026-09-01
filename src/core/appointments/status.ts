/**
 * Appointment statuses — CORE, specialty-agnostic. The single source of truth for
 * the status list, their display labels, badge styling, and the live-queue flow.
 * Client-safe (no server-only imports) so both the DB/server layer and the reception
 * UI import the same definitions.
 *
 * The live-queue lifecycle a patient moves through on the day:
 *   scheduled/confirmed → arrived (checked in, in the waiting room)
 *   → in_progress (called into the room — the real "now serving")
 *   → completed. `no_show` marks a patient who didn't turn up; `cancelled` a
 *   cancelled visit.
 */
export const APPOINTMENT_STATUSES = [
  "scheduled",
  "confirmed",
  "arrived",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

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
