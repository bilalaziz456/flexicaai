/**
 * The appointment number (queue token) rules shared by the booking form and the
 * server. Pure — no DB, no `server-only` — so the form's suggestion and the server's
 * allocation are one rule.
 *
 * A number is unique per doctor per day (core/appointments/queue.ts says why). The
 * next one is the LOWEST number nobody holds, not "highest + 1" (owner, 2026-11-12):
 * the desk may hold a later number for a patient who will come in an hour — #10 while
 * #5 is the last booked — and the bookings after that take 6, 7, 8, 9 and then 11.
 * With no number held out of turn the two rules give the same answer.
 */
import { z } from "zod";

/** Upper bound on a typed number — a typo guard, far above any real day's queue. */
export const MAX_QUEUE_NUMBER = 999;

/** The lowest positive number not in `taken`. */
export function lowestFreeNumber(taken: Iterable<number>): number {
  const held = new Set(taken);
  let n = 1;
  while (held.has(n)) n++;
  return n;
}

/** A number typed at the desk. Empty = let the system pick. */
export const requestedQueueNumberSchema = z
  .union([z.literal(""), z.coerce.number().int("Appointment number must be a whole number.")])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v))
  .refine((v) => v === null || (v >= 1 && v <= MAX_QUEUE_NUMBER), {
    message: `Appointment number must be between 1 and ${MAX_QUEUE_NUMBER}.`,
  });

export function queueNumberTakenMessage(n: number): string {
  return `Appointment number ${n} is already given to another patient of this doctor on that day. Pick another number, or clear it to take the next free one.`;
}
