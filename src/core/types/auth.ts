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
  "doctor", // Clinical user — voice scribe, records, prescriptions
  "receptionist", // Front desk — appointments, WhatsApp, payments
] as const;

export type UserRole = (typeof USER_ROLES)[number];

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
  clinic_admin: "/clinic",
  doctor: "/doctor",
  receptionist: "/reception",
};

/**
 * Which roles may access each protected route prefix. Middleware uses this to
 * block, e.g., a receptionist from opening /admin. Order matters: longer, more
 * specific prefixes should be checked first (see matchProtectedPrefix).
 */
export const ROUTE_ROLE_ACCESS: { prefix: string; roles: UserRole[] }[] = [
  { prefix: "/admin", roles: ["super_admin"] },
  { prefix: "/clinic", roles: ["clinic_admin"] },
  { prefix: "/doctor", roles: ["doctor"] },
  { prefix: "/reception", roles: ["receptionist"] },
];

export function matchProtectedPrefix(pathname: string) {
  return ROUTE_ROLE_ACCESS.find(
    (r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`),
  );
}

/**
 * The authenticated user as the rest of the app consumes it. `clinicId` is null
 * for super_admin (company staff belong to no single clinic) and until an admin
 * assigns a newly signed-up user to a clinic.
 */
export interface CurrentUser {
  id: string;
  email: string | null;
  role: UserRole | null;
  clinicId: string | null;
}
