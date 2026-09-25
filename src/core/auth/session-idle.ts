/**
 * The idle-timeout window — pure, so both the server guard and the client form read
 * one list (conventions §3, the same split `retention-options.ts` makes).
 *
 * 0 MEANS NEVER, and it is the default. An idle timeout trades security against
 * interruption, and where that line falls depends on the room rather than on code: a
 * doctor's own laptop is not a reception counter three people share. ADR-023 settled
 * the same question for the audit log the same way — ship the machinery inert and let
 * the owner choose.
 */
export const SESSION_IDLE_OPTIONS = [0, 15, 30, 60, 120, 240, 480] as const;

/**
 * The floor on a window that IS set. Below this the timeout stops being a safeguard
 * and becomes a fault: somebody reading a long clinical note, or filling in a booking
 * form carefully, makes no requests while they do it, and would be signed out
 * mid-sentence. `activity_log_retention_days` carries a 90-day floor for the mirror
 * reason — a setting whose extreme values are harmful should not accept them.
 */
export const SESSION_IDLE_MIN_MINUTES = 15;

/** Narrows an arbitrary number to a usable window: 0 (off), or at least the floor. */
export function normalizeIdleMinutes(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.max(SESSION_IDLE_MIN_MINUTES, Math.round(minutes));
}

/** "30 minutes" / "2 hours" / "Never" — one label, so the admin form and the account
 *  page cannot describe the same setting differently. */
export function idleLabel(minutes: number): string {
  if (minutes <= 0) return "Never";
  if (minutes < 60) return `${minutes} minutes`;
  const h = minutes / 60;
  return `${h} ${h === 1 ? "hour" : "hours"}`;
}
