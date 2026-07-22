/**
 * Super-admin RBAC — CORE, PURE (Feature 9). The COMPANY-side permission model,
 * separate from the clinic `resource:action` catalog in `permissions.ts`. A
 * super-admin's admin capabilities are stored as slugs in the SAME
 * `users.permissions` column (a different namespace — clinic `can()` ignores them
 * because super_admin short-circuits to all clinic perms). NULL permissions = the
 * `owner` sub-role (everything), so the existing seed super-admin is unchanged.
 */

export const ADMIN_CAPABILITIES = [
  { id: "clinics:manage", label: "Manage clinics", desc: "Create/edit clinics, lifecycle status, staff, contact." },
  { id: "capabilities:manage", label: "Per-clinic capabilities", desc: "Toggle each clinic's allowed actions." },
  { id: "billing:view", label: "View billing", desc: "See clinic billing status + the due/overdue list (read-only)." },
  { id: "billing:manage", label: "Manage billing", desc: "Set price, record/void clinic payments." },
  { id: "impersonate", label: "Impersonate", desc: "Open a clinic's workspace read-only." },
  { id: "announcements:manage", label: "Announcements", desc: "Post notices to clinics." },
  { id: "delete", label: "Delete clinics", desc: "Move a clinic to Trash." },
  { id: "purge", label: "Purge", desc: "Permanently delete trashed data (legal)." },
  { id: "metrics:view", label: "Company metrics", desc: "See the revenue dashboard." },
] as const;

export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number]["id"];
export const ADMIN_CAPABILITY_IDS = ADMIN_CAPABILITIES.map((c) => c.id) as AdminCapability[];
const ALL = new Set<string>(ADMIN_CAPABILITY_IDS);

export type AdminSubRole = "owner" | "support" | "sales" | "billing";

/** Sub-role → capability preset (the UI assigns these; stored expanded on the user). */
export const ADMIN_SUBROLE_PRESETS: Record<AdminSubRole, AdminCapability[]> = {
  owner: [...ADMIN_CAPABILITY_IDS],
  support: ["clinics:manage", "impersonate", "announcements:manage", "metrics:view", "billing:view"],
  // Sales: onboard + manage clinics, see the numbers, and see which clinics are due/overdue
  // (read-only billing) — but not record payments, impersonate, or delete.
  sales: ["clinics:manage", "metrics:view", "billing:view"],
  billing: ["billing:manage", "billing:view", "metrics:view"],
};

/** Human labels + one-line descriptions for the sub-roles (UI). */
export const ADMIN_SUBROLE_META: Record<AdminSubRole, { label: string; desc: string }> = {
  owner: { label: "Owner", desc: "Full access — the only role that manages the team." },
  support: { label: "Support", desc: "Manage clinics, impersonate, post announcements, view metrics + overdue." },
  sales: { label: "Sales", desc: "Add & manage clinics, view metrics + which clinics are overdue." },
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

/** Does this super-admin hold an admin capability? */
export function canAdmin(user: AdminUser, capability: AdminCapability): boolean {
  return adminCapabilitySet(user).has(capability);
}

/** An OWNER super-admin holds every capability — the only one who manages the team. */
export function isAdminOwner(user: AdminUser): boolean {
  return adminCapabilitySet(user).size === ADMIN_CAPABILITY_IDS.length;
}

/** Can this super-admin SEE billing (the due/overdue list + a clinic's billing status)?
 *  Managing billing implies seeing it. */
export function canSeeBilling(user: AdminUser): boolean {
  return canAdmin(user, "billing:view") || canAdmin(user, "billing:manage");
}

/** Best-effort label of a super-admin's sub-role from their stored capabilities. */
export function adminSubRoleOf(user: AdminUser): AdminSubRole | "custom" {
  if (user.permissions == null) return "owner";
  const have = new Set(sanitizeAdminCapabilities(user.permissions));
  for (const [role, caps] of Object.entries(ADMIN_SUBROLE_PRESETS) as [AdminSubRole, AdminCapability[]][]) {
    if (caps.length === have.size && caps.every((c) => have.has(c))) return role;
  }
  return "custom";
}
