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
  // Data import (clinic onboarding) — create = run an import for a clinic. Owner +
  // super_admin by default; grantable. See docs/import-plan.md.
  { id: "import", label: "Data import", actions: ["create"], createLabel: "Run" },
  // view=billing status+overdue; create=record payment; edit=set price; delete=void payment.
  { id: "billing", label: "Billing", actions: ["view", "create", "edit", "delete"], createLabel: "Record" },
  { id: "announcements", label: "Announcements", actions: ["view", "create", "edit", "delete"] },
  // view = open account settings; edit = change name/password/picture.
  { id: "account", label: "Account settings", actions: ["view", "edit"] },
  // Company team accounts. view=see team + open profiles; create=add a member;
  // edit=name/password/state (suspend/deactivate/reactivate)/reassign/capabilities;
  // delete=delete a member (with a password step-up). Only full admins can GRANT
  // capabilities they don't hold (see canGrantAdminCapabilities).
  { id: "team", label: "Team", actions: ["view", "create", "edit", "delete"] },
  // Single-action resources (matrix shows only their column).
  { id: "impersonate", label: "Impersonation", actions: ["view"] }, // view = may impersonate
  { id: "metrics", label: "Company metrics", actions: ["view"] }, // the dashboard panel (collected/overdue/totals)
  // The recurring-revenue figures specifically (MRR + ARR) — the most sensitive
  // company financials. Separate from `metrics` so a scoped user can see the panel
  // without seeing headline revenue. Owner + super_admin by default; grantable.
  { id: "revenue", label: "Revenue (MRR / ARR)", actions: ["view"] },
  // Owner Finance — split into FOUR independently-grantable areas so, e.g., a
  // bookkeeper can manage expenses without seeing the P&L. Owner + super_admin by
  // default; grantable. See docs/owner-finance-plan.md.
  { id: "pnl", label: "Company P&L", actions: ["view"] }, // /admin/finance dashboard + CSV export
  { id: "serving_cost", label: "Serving cost", actions: ["view", "edit"] }, // /admin/finance/costs; edit = unit rates
  { id: "expenses", label: "Operating expenses", actions: ["view", "create", "edit", "delete"] }, // /admin/finance/expenses
  { id: "sub_invoices", label: "Subscription invoices", actions: ["view", "create", "delete"] }, // /admin/finance/invoices; create=issue, delete=void
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
    "account:view", "account:edit",
  ],
  // Sales: onboard + manage clinics, see the numbers + which clinics are overdue
  // (read-only billing) — no record payments, impersonate, delete or purge.
  sales: ["clinics:view", "clinics:create", "clinics:edit", "billing:view", "metrics:view", "account:view", "account:edit"],
  // Billing: full clinic billing (view/record/price/void) + issue/void subscription
  // invoices (the document side of the same bill-a-clinic cycle) + clinics + metrics.
  // NOT the P&L / serving cost / opex (owner-level "what WE earn/spend").
  billing: ["clinics:view", "billing:view", "billing:create", "billing:edit", "billing:delete", "sub_invoices:view", "sub_invoices:create", "sub_invoices:delete", "metrics:view", "account:view", "account:edit"],
};

/** Human labels + one-line descriptions for the sub-roles (UI). */
export const ADMIN_SUBROLE_META: Record<AdminSubRole, { label: string; desc: string }> = {
  owner: { label: "Owner", desc: "The account owner — full access; only the owner manages the owner." },
  super_admin: { label: "Super admin", desc: "Full access — clinics, billing, announcements and the team (can't touch the owner)." },
  support: { label: "Support", desc: "Manage clinics, impersonate, announcements, metrics + overdue." },
  sales: { label: "Sales", desc: "Add & manage clinics, metrics + which clinics are overdue." },
  billing: { label: "Billing", desc: "Record clinic payments, issue/void subscription invoices, view metrics + overdue." },
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

/** Team member account state. Both inactive states block login; `deactivated`
 *  additionally had its clinic assignments cleared. */
export type AdminAccountState = "active" | "suspended" | "deactivated";
export function adminAccountState(user: { isActive: boolean; deactivatedAt: Date | null }): AdminAccountState {
  if (user.isActive) return "active";
  return user.deactivatedAt ? "deactivated" : "suspended";
}

/** May manage the company team — owner OR super_admin (i.e. holds every capability). */
export function canManageTeam(user: AdminUser): boolean {
  return adminCapabilitySet(user).size === ADMIN_CAPABILITY_IDS.length;
}

/**
 * PRIVILEGE GUARD: an actor may only grant capabilities they themselves hold — so
 * a partial admin with `team:edit`/`team:create` can't mint or elevate someone
 * above their own access (no self- or lateral escalation). A full admin/owner
 * (holds everything) can grant anything.
 */
export function canGrantAdminCapabilities(actor: AdminUser, slugs: string[]): boolean {
  const mine = adminCapabilitySet(actor);
  if (mine.size === ADMIN_CAPABILITY_IDS.length) return true; // full/owner
  return sanitizeAdminCapabilities(slugs).every((s) => mine.has(s));
}

/** Can this super-admin SEE billing (the due/overdue list + a clinic's status)? */
export function canSeeBilling(user: AdminUser): boolean {
  for (const s of adminCapabilitySet(user)) if (s.startsWith("billing:")) return true;
  return false;
}

/**
 * Whether a user may VIEW/EDIT their own account settings. Self-service is
 * ACL-gated ONLY for super-admins (the admin panel); clinic staff always may
 * (returns true) so the shared /account page keeps working for them.
 */
export function canUseAccount(user: AdminUser, action: "view" | "edit"): boolean {
  if (user.role !== "super_admin") return true;
  return canAdmin(user, `account:${action}`);
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
