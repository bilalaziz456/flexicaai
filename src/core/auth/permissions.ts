/**
 * Permission model — CORE, specialty-agnostic, PURE (no DB / no server-only) so
 * both server guards and the clinic-admin permission grid (a client component)
 * share one source of truth.
 *
 * Access is TWO-TIER:
 *   1. Super admin → clinic capabilities (`clinics.modules_enabled` /
 *      `features_enabled` / `log_access`).
 *   2. Clinic admin → per-user permissions (`users.permissions`), granted here as
 *      `resource:action` slugs.
 *
 * A user's effective permissions = their stored array, or — when that is NULL —
 * the defaults for their role. Feature-gated resources (e.g. Sales) are still
 * additionally gated by the clinic having the feature; that check stays at the
 * page/query layer, and the grid only offers rows the clinic can use.
 */

import type { UserRole } from "@/core/types/auth";

export const PERM_ACTIONS = ["view", "create", "edit", "delete"] as const;
export type PermAction = (typeof PERM_ACTIONS)[number];

export type PermResource = {
  id: string;
  label: string;
  /** Which of view/create/edit/delete are meaningful for this resource. */
  actions: PermAction[];
  /** Clinic feature this resource requires (grid hides it unless enabled). */
  feature?: string;
  /** For the "create" column: some resources read better as "send" etc. */
  createLabel?: string;
};

/**
 * The full resource catalog. Not every resource supports all four actions — a
 * report is view-only, settings is view/edit, WhatsApp is view + "send". The grid
 * greys out the actions a resource doesn't declare.
 */
export const PERM_RESOURCES: PermResource[] = [
  { id: "appointments", label: "Appointments", actions: ["view", "create", "edit", "delete"] },
  { id: "patients", label: "Patients", actions: ["view", "create", "edit", "delete"] },
  { id: "clinical", label: "Clinical notes", actions: ["view", "create", "edit"] },
  { id: "prescriptions", label: "Prescriptions", actions: ["view", "create", "edit", "delete"] },
  { id: "recalls", label: "Recalls", actions: ["view", "create", "edit", "delete"] },
  { id: "whatsapp", label: "WhatsApp", actions: ["view", "create"], createLabel: "Send" },
  { id: "procedures", label: "Procedures", actions: ["view", "create", "edit", "delete"], feature: "sales" },
  { id: "sales", label: "Sales report", actions: ["view"], feature: "sales" },
  { id: "leave", label: "Doctor leave", actions: ["view", "create", "edit", "delete"] },
  { id: "staff", label: "Staff", actions: ["view", "create", "edit", "delete"] },
  { id: "settings", label: "Settings", actions: ["view", "edit"] },
  // Trash: `view` = see the clinic's Trash; `create` = RESTORE a trashed item
  // (reusing the create column, relabelled "Restore"). Permanent purge is NOT an
  // ACL action — it is super-admin-only. Clinic admin holds this by default (ALL);
  // other roles only if the admin grants it.
  { id: "trash", label: "Trash", actions: ["view", "create"], createLabel: "Restore" },
];

const RESOURCE_BY_ID = new Map(PERM_RESOURCES.map((r) => [r.id, r]));

/** Build a `resource:action` slug. */
export function permId(resource: string, action: PermAction): string {
  return `${resource}:${action}`;
}

/** Every valid slug in the catalog. */
export const ALL_PERMISSIONS: string[] = PERM_RESOURCES.flatMap((r) =>
  r.actions.map((a) => permId(r.id, a)),
);
const ALL_PERMISSION_SET = new Set(ALL_PERMISSIONS);
const VALID = ALL_PERMISSION_SET;

/** True if the slug is a recognised permission. */
export function isPermission(slug: string): boolean {
  return VALID.has(slug);
}

/** Keeps only recognised slugs (drops anything unknown / duplicated). */
export function sanitizePermissions(slugs: string[]): string[] {
  const seen = new Set<string>();
  return slugs.filter((s) => VALID.has(s) && !seen.has(s) && seen.add(s));
}

// ---- Role defaults -------------------------------------------------------

/** Compact builder: { appointments: ["view","create"], … } → slug list. */
function grant(map: Partial<Record<string, PermAction[]>>): string[] {
  return Object.entries(map).flatMap(([res, acts]) =>
    (acts ?? []).map((a) => permId(res, a)),
  );
}

const V: PermAction = "view";
const C: PermAction = "create";
const E: PermAction = "edit";
const D: PermAction = "delete";

/**
 * Default permissions per role. super_admin / clinic_admin get everything (they
 * are the delegators — enforced by a short-circuit in `permissionSet`, so this is
 * just documentation for them). The rest mirror today's behaviour so nothing
 * changes until a clinic admin customises a user.
 */
export const ROLE_DEFAULTS: Record<UserRole, string[]> = {
  super_admin: [...ALL_PERMISSIONS],
  clinic_admin: [...ALL_PERMISSIONS],
  // Operations manager — runs the front desk end-to-end, oversees leave &
  // procedures, and can VIEW clinical/prescriptions/sales/staff (but not author
  // clinical notes or change settings).
  manager: grant({
    appointments: [V, C, E, D],
    patients: [V, C, E, D],
    recalls: [V, C, E, D],
    whatsapp: [V, C],
    procedures: [V, C, E],
    sales: [V],
    leave: [V, C, E, D],
    clinical: [V],
    prescriptions: [V],
    // Trash: view + restore on by default (C = "Restore"); purge stays super-admin.
    trash: [V, C],
    // staff / settings management stays clinic-admin-only for now.
  }),
  // Clinical user — authors notes & prescriptions; sees (not edits) their
  // patients/appointments/recalls.
  doctor: grant({
    clinical: [V, C, E],
    prescriptions: [V, C, E, D],
    patients: [V],
    appointments: [V],
    recalls: [V],
    // A doctor manages their OWN leave only (self-scoped in the page + actions).
    leave: [V, C, E, D],
    // Trash: view + restore on by default (C = "Restore"); purge stays super-admin.
    trash: [V, C],
  }),
  // Front desk — books/edits appointments & patients, WhatsApp, recalls,
  // procedures catalog and doctor leave (matches current receptionist scope).
  receptionist: grant({
    appointments: [V, C, E, D],
    patients: [V, C, E, D],
    whatsapp: [V, C],
    recalls: [V, C, E],
    procedures: [V, C, E, D],
    leave: [V, C, E, D],
    // Front desk can view/print a prescription PDF (not author it).
    prescriptions: [V],
    // Trash: view + restore on by default (C = "Restore"); purge stays super-admin.
    trash: [V, C],
  }),
};

/** The default slug list for a role. */
export function defaultPermissionsForRole(role: UserRole): string[] {
  return ROLE_DEFAULTS[role] ?? [];
}

// ---- Runtime checks ------------------------------------------------------

type PermUser = { role: UserRole; permissions?: string[] | null };

/**
 * A user's effective permission set. super_admin / clinic_admin implicitly hold
 * everything; everyone else uses their stored array, or the role defaults when it
 * is NULL. (Feature-gating is applied separately at the page/query layer.)
 */
export function permissionSet(user: PermUser): ReadonlySet<string> {
  if (user.role === "super_admin" || user.role === "clinic_admin") {
    return ALL_PERMISSION_SET;
  }
  return new Set(user.permissions ?? defaultPermissionsForRole(user.role));
}

/** Does the user hold `resource:action`? */
export function can(user: PermUser, resource: string, action: PermAction): boolean {
  return permissionSet(user).has(permId(resource, action));
}

/** True if the user can do ANY action on a resource (i.e. should see its nav). */
export function canAccess(user: PermUser, resource: string): boolean {
  const res = RESOURCE_BY_ID.get(resource);
  if (!res) return false;
  const set = permissionSet(user);
  return res.actions.some((a) => set.has(permId(resource, a)));
}

/** Resources a clinic can use (drops feature-gated ones it hasn't enabled). */
export function resourcesForClinic(featuresEnabled: string[] | null | undefined): PermResource[] {
  const features = new Set(featuresEnabled ?? []);
  return PERM_RESOURCES.filter((r) => !r.feature || features.has(r.feature));
}

/** Resource ids the user can access (any action) — drives nav visibility. */
export function accessibleResourceIds(user: PermUser): string[] {
  return PERM_RESOURCES.filter((r) => canAccess(user, r.id)).map((r) => r.id);
}
