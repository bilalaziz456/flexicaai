/**
 * Authentication & authorization types — CORE, specialty-agnostic.
 *
 * Roles describe WHO a user is on the platform. They are independent of which
 * modules (dental/derma/hair) a clinic has enabled — a doctor is a doctor
 * whether the clinic does dentistry or dermatology. Never encode specialty
 * into a role.
 */

export const USER_ROLES = [
  "super_admin", // Klenic company staff — manages clinics & modules
  "clinic_admin", // Clinic owner — manages their staff & settings
  "manager", // Clinic operations manager — runs the front desk + oversight
  "doctor", // Clinical user — voice scribe, records, prescriptions
  "receptionist", // Front desk — appointments, WhatsApp, payments
] as const;

export type UserRole = (typeof USER_ROLES)[number];

/**
 * Roles a clinic admin creates and manages within their clinic — everyone but
 * themselves (clinic_admin) and platform staff (super_admin). Single source of
 * truth for the staff list, staff-management guards, and staff counts.
 */
export const CLINIC_STAFF_ROLES = ["manager", "doctor", "receptionist"] as const;

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && USER_ROLES.includes(value as UserRole);
}

/**
 * The panel each role lands in after login. These map to the route groups in
 * /src/app. Keep this the single source of truth for role→home routing so
 * middleware and post-login redirects never drift apart.
 */
export const ROLE_HOME_ROUTE: Record<UserRole, string> = {
  super_admin: "/admin",
  // All clinic staff share the unified permission-driven workspace; their nav +
  // page access come from their per-user permissions.
  clinic_admin: "/clinic",
  manager: "/clinic",
  doctor: "/clinic",
  receptionist: "/clinic",
};

/**
 * Which roles may access each protected route prefix. Middleware uses this to
 * block, e.g., a receptionist from opening /admin. Order matters: longer, more
 * specific prefixes should be checked first (see matchProtectedPrefix).
 */
export const ROUTE_ROLE_ACCESS: { prefix: string; roles: UserRole[] }[] = [
  { prefix: "/admin", roles: ["super_admin"] },
  // The unified clinic workspace — every clinic staff role; each page is gated by
  // the user's per-resource permissions (requireWorkspace).
  { prefix: "/clinic", roles: ["clinic_admin", "manager", "doctor", "receptionist"] },
  { prefix: "/doctor", roles: ["doctor"] },
  { prefix: "/reception", roles: ["receptionist", "manager"] },
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
}

/**
 * Username rules for login handles: lowercase letters, digits, dot, underscore,
 * hyphen; 3-32 chars. Kept here so login and account-creation validate identically.
 */
export const USERNAME_REGEX = /^[a-z0-9._-]+$/;
