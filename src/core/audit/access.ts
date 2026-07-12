/**
 * Activity-log access model — CORE, pure (client + server). Access is granted
 * PER CLINIC by the super admin as a set of ACTION categories the clinic admin
 * may see (`clinics.log_access`). Empty = the clinic has no log access at all.
 * The super admin always sees everything.
 */

export const LOG_ACTIONS = [
  { id: "login", label: "Logins" },
  { id: "view", label: "Views" },
  { id: "create", label: "Creates" },
  { id: "update", label: "Updates" },
  { id: "status", label: "Status changes" },
  { id: "delete", label: "Deletes" },
] as const;

export type LogActionId = (typeof LOG_ACTIONS)[number]["id"];

/**
 * Actor roles a CLINIC ADMIN may see in their own activity log — themselves and
 * their staff. Super-admin actions (even ones tagged with the clinic's id, e.g.
 * changing its settings) are deliberately excluded; only the super admin sees
 * those, on /admin/logs.
 */
export const CLINIC_LOG_ROLES = [
  "clinic_admin",
  "doctor",
  "receptionist",
] as const;

export const LOG_ACTION_IDS: readonly string[] = LOG_ACTIONS.map((a) => a.id);

/** Keeps only recognised action ids (drops anything unknown). */
export function sanitizeLogAccess(ids: string[]): string[] {
  const seen = new Set<string>();
  return ids.filter(
    (id) => LOG_ACTION_IDS.includes(id) && !seen.has(id) && seen.add(id),
  );
}

/** Human label for an action id (falls back to the id itself). */
export function logActionLabel(id: string): string {
  return LOG_ACTIONS.find((a) => a.id === id)?.label ?? id;
}
