import "server-only";

import { redirect } from "next/navigation";
import { getSessionUser } from "@/core/auth/session";
import { can, type PermAction } from "@/core/auth/permissions";
import {
  ROLE_HOME_ROUTE,
  type CurrentUser,
  type UserRole,
} from "@/core/types/auth";

/** The clinic-staff roles that share the unified workspace (not super_admin). */
const WORKSPACE_ROLES: UserRole[] = [
  "clinic_admin",
  "manager",
  "doctor",
  "receptionist",
];

/**
 * Reads the authenticated user for Server Components, Server Actions, and Route
 * Handlers. Returns null when signed out. Role and clinicId come straight from
 * the users table (the canonical source, CLAUDE.md §5).
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const user = await getSessionUser();
  if (!user) return null;

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    // role is a NOT NULL enum column, so it is always a valid UserRole here.
    role: user.role as UserRole,
    clinicId: user.clinicId,
    mustChangePassword: user.mustChangePassword,
    permissions: user.permissions ?? null,
  };
}

/** Redirects to /login if signed out; otherwise returns the user. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Guards a panel to specific role(s). Use at the top of a protected layout/page:
 *   const user = await requireRole("doctor");
 * This is the REAL authorization gate (the Edge proxy only does a coarse
 * cookie-presence check). Redirects to the user's own home if their role isn't
 * allowed, or to /login if signed out.
 */
export async function requireRole(
  allowed: UserRole | UserRole[],
): Promise<CurrentUser> {
  const user = await requireUser();
  const allowedRoles = Array.isArray(allowed) ? allowed : [allowed];

  if (!allowedRoles.includes(user.role)) {
    redirect(ROLE_HOME_ROUTE[user.role]);
  }
  // A user with a temporary password can't use any panel until they change it.
  if (user.mustChangePassword) {
    redirect("/change-password");
  }
  return user;
}

/**
 * Guards the Clinic Admin panel and guarantees a non-null clinicId, so callers
 * can scope every query to the admin's own clinic without null checks.
 */
export async function requireClinicAdmin(): Promise<
  CurrentUser & { clinicId: string }
> {
  const user = await requireRole("clinic_admin");
  // A clinic_admin should always have a clinic; if not, treat as unprovisioned.
  if (!user.clinicId) redirect("/login?error=no_access");
  return { ...user, clinicId: user.clinicId };
}

/**
 * Guards a page in the unified clinic workspace: any clinic staff member
 * (admin / manager / doctor / receptionist) with a clinic. When `resource` is
 * given, the user must hold `resource:action` (default `view`) or they're sent
 * back to /clinic. Guarantees a non-null clinicId so callers can scope queries.
 * (super_admin isn't clinic staff and is bounced to their own home.)
 */
export async function requireWorkspace(
  resource?: string,
  action: PermAction = "view",
): Promise<CurrentUser & { clinicId: string }> {
  const user = await requireRole(WORKSPACE_ROLES);
  if (!user.clinicId) redirect("/login?error=no_access");
  if (resource && !can(user, resource, action)) redirect("/clinic");
  return { ...user, clinicId: user.clinicId };
}
