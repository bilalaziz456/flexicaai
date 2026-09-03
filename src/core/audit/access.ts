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
 * The clinic's own STAFF roles — real `users.role` values. Used to build the
 * "employee" filter on the log pages, which lists people, so it must contain only
 * roles a user can actually hold.
 *
 * `manager` is here because a manager IS the clinic's staff. It was added as a role
 * in migration 0026 and never added to this list, so a manager's actions were logged
 * and then filtered out of the only log page their clinic can see.
 */
export const CLINIC_LOG_STAFF_ROLES = [
  "clinic_admin",
  "manager",
  "doctor",
  "receptionist",
] as const;

/**
 * Actor roles a CLINIC ADMIN may SEE in their own activity log. Staff, plus their
 * own patients' self-service actions.
 *
 * Super-admin actions (even ones tagged with the clinic's id, e.g. changing its
 * settings) are deliberately excluded; only the super admin sees those, on
 * /admin/logs.
 *
 * `patient` IS NOT A USER ROLE, and that is exactly why the filter sits on a TEXT
 * column. `activity_logs.actor_role` is a SNAPSHOT (ADR-027 kept it text so it
 * survives the role vocabulary changing), so it can carry an actor with no `users`
 * row at all — a WhatsApp self-service booking, reschedule or cancellation. The
 * patient is not a user, but the action changes their record and §10 requires it be
 * auditable. Omitting it here would write the row and then hide it, which is worse
 * than not writing one: the compliance gap would look closed.
 *
 * Kept separate from `CLINIC_LOG_STAFF_ROLES` because that list populates a picker of
 * PEOPLE and this one filters ROWS. Merging them puts "patient" in a staff dropdown.
 */
export const CLINIC_LOG_ROLES = [...CLINIC_LOG_STAFF_ROLES, "patient"] as const;

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
