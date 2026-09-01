/**
 * Authentication & authorization types — CORE, specialty-agnostic.
 *
 * Roles describe WHO a user is on the platform. They are independent of which
 * modules (dental/derma/hair) a clinic has enabled — a doctor is a doctor
 * whether the clinic does dentistry or dermatology. Never encode specialty
 * into a role.
 */

import { USER_ROLE_ROWS, type UserRoleCode } from "@/core/db/vocabulary-seed";

/**
 * The codes, derived from the user_role vocabulary rather than restated.
 *
 * The list lives in ONE place — `core/db/vocabulary-seed.ts`, which is also the
 * migration seed and what the start-up check compares the database against. Writing
 * it out a second time here is exactly the drift this whole change removed.
 * `vocabulary-seed` is client-safe (no `server-only`), so this module stays usable
 * from a client component.
 */
export const USER_ROLES: readonly UserRoleCode[] = USER_ROLE_ROWS.map((r) => r.code);

export type UserRole = UserRoleCode;

/**
 * Roles a clinic admin creates and manages within their clinic — everyone but
 * platform staff (super_admin). Single source of truth for the staff list,
 * staff-management guards, and staff counts.
 *
 * **`clinic_admin` is in this list on purpose** (added 2026-08-26): a clinic needs
 * more than one person who can run it — an owner on leave, a practice manager, a
 * second partner — and the alternative was handing out one shared login, which
 * destroys the audit trail that CLAUDE.md §10 exists to keep. Admins are therefore
 * PEERS: they can create, edit, suspend and delete each other.
 *
 * That peerage is safe because of exactly one invariant, enforced in
 * `core/users/clinic-staff.ts#assertNotLastAdmin`: **a clinic can never be left with
 * no active admin.** Without it the feature is a footgun — two admins suspend each
 * other, or the only one deletes themselves, and the clinic is locked out of its own
 * staff and settings pages with only the super admin able to rescue it.
 */
export const CLINIC_STAFF_ROLES = [
  "clinic_admin",
  "manager",
  "doctor",
  "receptionist",
] as const;

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && USER_ROLES.includes(value as UserRole);
}

/** Selectable name prefixes/titles for staff (e.g. a doctor is "Dr. Bilal Aziz"). */
export const STAFF_PREFIXES = ["Dr", "Prof", "Mr", "Mrs", "Ms", "Miss"] as const;
export type StaffPrefix = (typeof STAFF_PREFIXES)[number];

/**
 * Display a staff member's name with their prefix — "Dr. Bilal Aziz". Falls back to
 * the plain name when there's no prefix, and to `fallback` (e.g. username) when
 * there's no full name. Used in the UI and in patient WhatsApp messages.
 */
export function displayStaffName(
  prefix: string | null | undefined,
  fullName: string | null | undefined,
  fallback = "",
): string {
  const name = (fullName ?? "").trim() || fallback;
  const p = (prefix ?? "").trim();
  if (!p) return name;
  return name ? `${p}. ${name}` : `${p}.`;
}

/**
 * Up-to-two-letter initials for the avatar fallback — derived from the full name
 * (or the username when there's no name), NEVER the prefix, so "Dr. Bilal Aziz" →
 * "BA". Shared by the account page and the top-bar avatar so both match.
 */
export function staffInitials(
  fullName: string | null | undefined,
  fallback = "",
): string {
  const name = ((fullName ?? "").trim() || fallback).trim();
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * The panel each role lands in after login. These map to the route groups in
 * /src/app. Keep this the single source of truth for role→home routing so
 * middleware and post-login redirects never drift apart.
 */
export const ROLE_HOME_ROUTE: Record<UserRole, string> = {
  // The Owner Overview is the super-admin's landing page (company at a glance);
  // the clinics working list lives at /admin. Every admin sub-role holds
  // `metrics:view`, so the Overview is reachable by all of them.
  super_admin: "/admin/overview",
  // All clinic staff share the unified permission-driven workspace; their nav +
  // page access come from their per-user permissions.
  clinic_admin: "/clinic",
  manager: "/clinic",
  doctor: "/clinic",
  receptionist: "/clinic",
};

/**
 * Which roles may access each protected route prefix. The Edge proxy uses this for a
 * coarse bounce; the REAL gate is `requireRole` server-side. Order matters: longer,
 * more specific prefixes should be checked first (see matchProtectedPrefix).
 *
 * There are only two panels: the company's and the clinic workspace. `/doctor` and
 * `/reception` are gone — folded into `/clinic` (ADR-019) — and are deliberately NOT
 * listed, so their catch-all redirect stubs are reachable by any signed-in staff
 * member rather than bounced by role first.
 */
export const ROUTE_ROLE_ACCESS: { prefix: string; roles: UserRole[] }[] = [
  { prefix: "/admin", roles: ["super_admin"] },
  // The unified clinic workspace — every clinic staff role; each page is gated by
  // the user's per-resource permissions (requireWorkspace).
  { prefix: "/clinic", roles: ["clinic_admin", "manager", "doctor", "receptionist"] },
];

export function matchProtectedPrefix(pathname: string) {
  return ROUTE_ROLE_ACCESS.find(
    (r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`),
  );
}

/**
 * The authenticated user as the rest of the app consumes it. A signed-in user
 * always has a role (NOT NULL in the DB). `clinicId` is null for super_admin
 * (company staff belong to no single clinic).
 */
export interface CurrentUser {
  id: string;
  /** Login handle, e.g. "admin". */
  username: string;
  /** Optional contact email (not used for login). */
  email: string | null;
  /** Name title (Dr/Mr/Miss…) and full name — for "Dr. Bilal Aziz" displays. */
  prefix: string | null;
  fullName: string | null;
  /** Storage key of the profile picture, or null (served via /api/me/avatar). */
  avatarKey: string | null;
  role: UserRole;
  clinicId: string | null;
  /** True while the user still has an admin-issued temporary password. */
  mustChangePassword: boolean;
  /**
   * Per-user permission slugs (`resource:action`). NULL means "use the role's
   * defaults" — see `core/auth/permissions.ts`. An explicit (possibly empty)
   * array is an admin override that replaces the defaults entirely.
   */
  permissions: string[] | null;
  /**
   * The user's CLINIC capabilities (`clinics.capabilities`) — the super-admin
   * per-clinic control whitelist. NULL = all allowed. Carried on the user so every
   * `can()` check applies clinic capability ∩ user permission (see `clinicAllows`).
   * Always null for super_admin (no clinic).
   */
  capabilities: string[] | null;
  /**
   * Set when a super-admin is viewing a clinic's workspace (Feature 5). The user
   * then resolves as a READ-ONLY clinic_admin of `clinicId`, but `id`/`username`
   * stay the real super-admin's (for the audit trail). null in every normal case.
   */
  impersonation: { clinicId: string; clinicName: string } | null;
}

/**
 * Username rules for login handles: lowercase letters, digits, dot, underscore,
 * hyphen; 3-32 chars. Kept here so login and account-creation validate identically.
 */
export const USERNAME_REGEX = /^[a-z0-9._-]+$/;
