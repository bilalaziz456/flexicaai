/**
 * Super-admin RBAC — CORE, PURE (Feature 9). The COMPANY-side permission model,
 * now expressed as the SAME resource × View/Create/Edit/Delete matrix the clinic
 * staff ACL uses (so the admin capability editor reuses `PermissionMatrix`).
 * Slugs live in `users.permissions` (a different namespace — clinic `can()` ignores
 * them because super_admin short-circuits). NULL permissions = the `owner`
 * sub-role (everything), so the seed super-admin is unchanged.
 */

import { permId, type PermResource } from "@/core/auth/permissions";

/** Admin ACL resources. Not all support all four actions (matrix greys the rest). */
export const ADMIN_RESOURCES: PermResource[] = [
  // view=see clinics; create=add clinic; edit=settings/status/contact/capabilities/staff; delete=trash.
  { id: "clinics", label: "Clinics", actions: ["view", "create", "edit", "delete"] },
  // view=billing status+overdue; create=record payment; edit=set price; delete=void payment.
  { id: "billing", label: "Billing", actions: ["view", "create", "edit", "delete"], createLabel: "Record" },
  { id: "announcements", label: "Announcements", actions: ["view", "create", "edit", "delete"] },
  // Single-action resources (matrix shows only their column).
  { id: "impersonate", label: "Impersonation", actions: ["view"] }, // view = may impersonate
  { id: "metrics", label: "Company metrics", actions: ["view"] },
  { id: "purge", label: "Data purge", actions: ["delete"] }, // delete = may legal-purge
];

export const ADMIN_CAPABILITY_IDS: string[] = ADMIN_RESOURCES.flatMap((r) =>
  r.actions.map((a) => permId(r.id, a)),
);
const ALL = new Set(ADMIN_CAPABILITY_IDS);

/**
 * Team hierarchy (top → bottom):
 *  - `owner`      — THE founder account (no explicit permission list = all). The
 *                   only one who can see/manage the owner account. Not assignable.
 *  - `super_admin`— full capabilities (everything the owner can do operationally,
 *                   incl. managing the team) but the OWNER is invisible/untouchable.
 *  - support / sales / billing — scoped; can't manage the team.
 */
export type AdminSubRole = "owner" | "super_admin" | "support" | "sales" | "billing";

/** Roles that can be ASSIGNED via the team UI (owner is the NULL-perms founder). */
export type AssignableSubRole = "super_admin" | "support" | "sales" | "billing";
export const ASSIGNABLE_SUBROLES: AssignableSubRole[] = ["super_admin", "support", "sales", "billing"];

/** Sub-role → capability preset (the UI assigns these; stored expanded on the user). */
export const ADMIN_SUBROLE_PRESETS: Record<AssignableSubRole, string[]> = {
  super_admin: [...ADMIN_CAPABILITY_IDS],
  support: [
    "clinics:view", "clinics:create", "clinics:edit",
    "billing:view",
    "announcements:view", "announcements:create", "announcements:edit", "announcements:delete",
    "impersonate:view", "metrics:view",
  ],
  // Sales: onboard + manage clinics, see the numbers + which clinics are overdue
  // (read-only billing) — no record payments, impersonate, delete or purge.
  sales: ["clinics:view", "clinics:create", "clinics:edit", "billing:view", "metrics:view"],
  // Billing: full billing (view/record/price/void) + see clinics + metrics.
  billing: ["clinics:view", "billing:view", "billing:create", "billing:edit", "billing:delete", "metrics:view"],
};

/** Human labels + one-line descriptions for the sub-roles (UI). */
export const ADMIN_SUBROLE_META: Record<AdminSubRole, { label: string; desc: string }> = {
  owner: { label: "Owner", desc: "The account owner — full access; only the owner manages the owner." },
  super_admin: { label: "Super admin", desc: "Full access — clinics, billing, announcements and the team (can't touch the owner)." },
  support: { label: "Support", desc: "Manage clinics, impersonate, announcements, metrics + overdue." },
  sales: { label: "Sales", desc: "Add & manage clinics, metrics + which clinics are overdue." },
  billing: { label: "Billing", desc: "Record clinic payments, view metrics + overdue." },
};

/** Keep only recognised admin capability slugs. */
export function sanitizeAdminCapabilities(slugs: string[]): string[] {
  const seen = new Set<string>();
  return slugs.filter((s) => ALL.has(s) && !seen.has(s) && seen.add(s));
}

type AdminUser = { role: string; permissions?: string[] | null };

/** A super-admin's effective admin capabilities. NULL = owner (all). */
export function adminCapabilitySet(user: AdminUser): ReadonlySet<string> {
  if (user.role !== "super_admin") return new Set();
  if (user.permissions == null) return ALL; // owner by default
  return new Set(sanitizeAdminCapabilities(user.permissions));
}

/** Does this super-admin hold an admin capability (`resource:action`)? */
export function canAdmin(user: AdminUser, capability: string): boolean {
  return adminCapabilitySet(user).has(capability);
}

/** THE owner — the founder account (no explicit permission list = all). Only the
 *  owner may see/manage the owner account. */
export function isOwner(user: AdminUser): boolean {
  return user.role === "super_admin" && user.permissions == null;
}

/** May manage the company team — owner OR super_admin (i.e. holds every capability). */
export function canManageTeam(user: AdminUser): boolean {
  return adminCapabilitySet(user).size === ADMIN_CAPABILITY_IDS.length;
}

/** Can this super-admin SEE billing (the due/overdue list + a clinic's status)? */
export function canSeeBilling(user: AdminUser): boolean {
  for (const s of adminCapabilitySet(user)) if (s.startsWith("billing:")) return true;
  return false;
}

/** Can this super-admin CHANGE billing (record/void payments, set price)? */
export function canManageBilling(user: AdminUser): boolean {
  return (
    canAdmin(user, "billing:create") ||
    canAdmin(user, "billing:edit") ||
    canAdmin(user, "billing:delete")
  );
}

/** Best-effort label of a super-admin's sub-role from their stored capabilities. */
export function adminSubRoleOf(user: AdminUser): AdminSubRole | "custom" {
  if (user.permissions == null) return "owner";
  const have = new Set(sanitizeAdminCapabilities(user.permissions));
  if (have.size === ADMIN_CAPABILITY_IDS.length) return "super_admin";
  for (const [role, caps] of Object.entries(ADMIN_SUBROLE_PRESETS) as [AssignableSubRole, string[]][]) {
    if (role === "super_admin") continue;
    if (caps.length === have.size && caps.every((c) => have.has(c))) return role;
  }
  return "custom";
}
