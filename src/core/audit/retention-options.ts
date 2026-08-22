/**
 * The retention windows offered for `activity_logs` — PURE (no DB, no `server-only`),
 * because both the server action that validates the choice and the client form that
 * offers it must use the SAME list. Same reason `core/appointments/fee.ts` and
 * `core/auth/permissions.ts` are pure: a second copy is a second thing to forget.
 *
 * `0` is first and means keep everything. It is the default deliberately — see
 * `core/audit/retention.ts` for why that is a compliance decision, not an
 * engineering one.
 */
export const RETENTION_DAYS_OPTIONS = [0, 90, 180, 365, 730, 1095, 1825] as const;

/** Human label for a window. Used by the form and by the audit summary. */
export function retentionLabel(days: number): string {
  if (days <= 0) return "Keep everything";
  if (days % 365 === 0) {
    const years = days / 365;
    return `${years} year${years === 1 ? "" : "s"}`;
  }
  return `${days} days`;
}
