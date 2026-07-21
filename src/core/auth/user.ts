import "server-only";

import { redirect } from "next/navigation";
import { getSession, getSessionUser } from "@/core/auth/session";
import { getClinic } from "@/core/clinics/get-clinic";
import { isClinicUsable } from "@/core/clinics/status";
import { can, VIEW_ONLY_CAPABILITIES, type PermAction } from "@/core/auth/permissions";
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
  const session = await getSession();
  if (!session) return null;
  const { user, impersonatedClinicId } = session;

  // Impersonation (Feature 5): a super-admin with an active `impersonated_clinic_id`
  // resolves as a READ-ONLY clinic_admin of that clinic — full VIEW of the
  // workspace, but capabilities restricted to `:view` so no mutation `can()` check
  // passes. The real super-admin's id/username stay for the audit trail.
  if (user.role === "super_admin" && impersonatedClinicId) {
    const clinic = await getClinic(impersonatedClinicId);
    if (clinic && !clinic.deletedAt) {
      return {
        id: user.id,
        username: user.username,
        email: user.email,
        prefix: user.prefix,
        fullName: user.fullName,
        avatarKey: user.avatarKey,
        role: "clinic_admin",
        clinicId: impersonatedClinicId,
        mustChangePassword: false,
        permissions: null,
        // Read-only: the clinic's own caps intersected down to view-only.
        capabilities: VIEW_ONLY_CAPABILITIES.filter(
          (s) => !clinic.capabilities || clinic.capabilities.includes(s),
        ),
        impersonation: { clinicId: impersonatedClinicId, clinicName: clinic.name },
      };
    }
    // Stale/deleted target → fall through to the normal super-admin identity.
  }

  // Clinic capabilities (super-admin per-clinic control) ride on the user so every
  // `can()` check applies them (Feature 3). Only clinic staff have a clinic; the
  // read is request-cached (the layout + Feature-2 guard already load it), so this
  // adds no query. super_admin has no clinic → capabilities stay null (unrestricted).
  let capabilities: string[] | null = null;
  if (user.clinicId && user.role !== "super_admin") {
    const clinic = await getClinic(user.clinicId);
    capabilities = clinic?.capabilities ?? null;
  }

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    prefix: user.prefix,
    fullName: user.fullName,
    avatarKey: user.avatarKey,
    // role is a NOT NULL enum column, so it is always a valid UserRole here.
    role: user.role as UserRole,
    clinicId: user.clinicId,
    mustChangePassword: user.mustChangePassword,
    permissions: user.permissions ?? null,
    capabilities,
    impersonation: null,
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
  // Clinic-level access block (super-admin control plane): if this staff member's
  // clinic isn't usable (suspended / past-due / cancelled / trial expired) they're
  // sent to /paused. ONE chokepoint — every panel page AND every clinic mutation
  // guarded by requireRole is covered. super_admin has no clinic and is exempt.
  // getClinic is request-cached, so this adds no query the layout wasn't already
  // running. /paused itself uses requireUser, not requireRole, so it never loops.
  // Impersonation is EXEMPT — a super-admin often views a clinic BECAUSE it's
  // suspended/past-due (support diagnosis).
  if (user.clinicId && user.role !== "super_admin" && !user.impersonation) {
    const clinic = await getClinic(user.clinicId);
    if (clinic && !isClinicUsable(clinic)) {
      redirect("/paused");
    }
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
