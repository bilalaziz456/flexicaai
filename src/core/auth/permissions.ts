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
  // Clinical imaging/photos/docs (x-rays, before/after photos, consent forms).
  // `delete` soft-deletes. Photo attachments are additionally gated by the patient's
  // photo_consent, enforced server-side. Doctor + clinic admin hold it by default.
  { id: "attachments", label: "Clinical attachments", actions: ["view", "create", "delete"] },
  // Multi-visit treatment plans (priced, tooth-tagged). Its own slug so the front
  // desk can be granted plan VIEW (to schedule plan items onto appointments) without
  // full clinical access. Doctor + clinic admin author; reception views by default.
  { id: "plans", label: "Treatment plans", actions: ["view", "create", "edit", "delete"] },
  { id: "prescriptions", label: "Prescriptions", actions: ["view", "create", "edit", "delete"] },
  { id: "recalls", label: "Recalls", actions: ["view", "create", "edit", "delete"] },
  { id: "whatsapp", label: "WhatsApp", actions: ["view", "create"], createLabel: "Send" },
  { id: "procedures", label: "Procedures", actions: ["view", "create", "edit", "delete"], feature: "sales" },
  { id: "sales", label: "Sales report", actions: ["view"], feature: "sales" },
  // Discounts report — who got what discount, borne by whom, approval state.
  { id: "discounts", label: "Discounts report", actions: ["view"], feature: "sales" },
  // Patient billing: `view` = see bills/balances/invoices; `create` = Collect a
  // payment / issue an invoice; `edit` = apply advance / edit a note; `delete` =
  // Void a payment/advance (stricter — front-desk collects, a manager/admin
  // reverses). NOTE: refunds are a SEPARATE resource (`refund`) below — a clinic
  // can grant refund without also granting the power to void arbitrary payments.
  { id: "billing", label: "Billing & payments", actions: ["view", "create", "edit", "delete"], feature: "sales", createLabel: "Collect" },
  // Refunds — money back to the patient. Split OUT of billing so refund can be
  // granted independently of voiding payments. `create` = issue a refund;
  // `delete` = reverse (void) a refund entry. No `edit` — a refund isn't edited,
  // it's reversed and re-issued (the grid greys Edit out automatically). Same
  // `sales` gate as billing.
  { id: "refund", label: "Refunds", actions: ["view", "create", "delete"], feature: "sales", createLabel: "Refund" },
  // Receivables report — what patients owe on completed visits (view-only). Its own
  // ACL slug so a clinic can expose the "who owes us" report independently of who may
  // collect a payment (billing).
  { id: "receivables", label: "Receivables report", actions: ["view"], feature: "sales" },
  // Revenue-share earnings report. A DOCTOR holds this by default but only ever
  // sees their OWN earnings (self-scoped at the page); a clinic admin / granted
  // manager sees every doctor + the clinic's cut. Not feature-gated (shares can
  // accrue from consultation fees without the sales feature).
  { id: "shares", label: "Revenue shares", actions: ["view"] },
  { id: "leave", label: "Doctor leave", actions: ["view", "create", "edit", "delete"] },
  { id: "staff", label: "Staff", actions: ["view", "create", "edit", "delete"] },
  { id: "settings", label: "Settings", actions: ["view", "edit"] },
  // Expenses (Finance feature) — owner-level; clinic admin holds it by default,
  // grantable to a manager. `delete` soft-deletes (recoverable).
  { id: "expenses", label: "Expenses", actions: ["view", "create", "edit", "delete"], feature: "finance" },
  // P&L + the unified finance reports/dashboard KPIs (owner overview).
  { id: "finance", label: "Profit & Loss", actions: ["view"], feature: "finance" },
  // Discount approvals: `view` = review & decide CLINIC-borne discount requests in
  // the approval queue (createLabel "Approve" is just the column's label). A doctor
  // always decides discounts off their OWN share regardless of this — it is only
  // for the clinic-borne side. Clinic admin holds it by default; grantable to a
  // manager. Not feature-gated (discounts exist without the sales feature).
  { id: "discount_approval", label: "Discount approvals", actions: ["view"] },
  // Doctor↔clinic discount SETTLEMENT actions — `view` = perform them: waive a
  // doctor's deficit, record a doctor→clinic repayment, write off a balance, and
  // reverse any of these (see docs/discount-bearing-plan.md). A doctor waiving their
  // OWN share needs no permission (self-identity). Clinic admin holds it by default;
  // grantable to a manager. Not feature-gated (shares accrue without sales/finance).
  { id: "share_waive", label: "Doctor share settlement", actions: ["view"] },
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
    discounts: [V],
    receivables: [V],
    // Full billing incl. void (manager oversees the money).
    billing: [V, C, E, D],
    // Manager can refund + reverse a refund (money oversight).
    refund: [V, C, D],
    leave: [V, C, E, D],
    clinical: [V],
    // Manager sees treatment plans (oversight + scheduling).
    plans: [V],
    prescriptions: [V],
    // Trash: view + restore on by default (C = "Restore"); purge stays super-admin.
    trash: [V, C],
    // staff / settings management stays clinic-admin-only for now.
  }),
  // Clinical user — authors notes & prescriptions; sees (not edits) their
  // patients/appointments/recalls.
  doctor: grant({
    clinical: [V, C, E],
    // Clinical imaging — a doctor uploads/views x-rays & photos, and can remove them.
    attachments: [V, C, D],
    // Treatment plans — a doctor proposes/edits the course.
    plans: [V, C, E, D],
    prescriptions: [V, C, E, D],
    patients: [V],
    appointments: [V],
    recalls: [V],
    // A doctor sees their OWN revenue-share earnings (self-scoped in the page).
    shares: [V],
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
    // Front desk collects payments + applies advances, but not void (no D) and
    // not refund (the `refund` resource is not granted) — an admin/manager reverses.
    billing: [V, C, E],
    // Front desk chases balances → sees the receivables report.
    receivables: [V],
    leave: [V, C, E, D],
    // Front desk can view/print a prescription PDF (not author it).
    prescriptions: [V],
    // Front desk sees treatment plans to schedule their items onto appointments.
    plans: [V],
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
