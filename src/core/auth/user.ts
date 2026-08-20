import "server-only";

import { redirect } from "next/navigation";
import { getSession } from "@/core/auth/session";
import { getClinic } from "@/core/clinics/get-clinic";
import { isClinicUsable } from "@/core/clinics/status";
import { can, VIEW_ONLY_CAPABILITIES, type PermAction } from "@/core/auth/permissions";
import { canAdmin } from "@/core/auth/admin-permissions";
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

// ---- The shared access predicate ----------------------------------------
//
// Panels and Route Handlers need the SAME access rules but can't share a guard that
// calls `redirect()` — an API caller needs a status code, not a 307 to an HTML login
// page. That split is why ten Route Handlers grew their own `getCurrentUser() +
// can()` checks and quietly skipped the clinic-usable and must-change-password gates
// that `requireRole` enforces: a suspended clinic's staff were bounced from every
// page but could still pull a full patient CSV from /api/patients/export.
//
// So the rules live HERE, once, in a function that decides but never acts. The
// page guards below turn a denial into a redirect; `apiRequire*` turns the same
// denial into a Response. Neither can drift from the other again.

/** Why access was refused — the page and API guards each render this their own way. */
type Denial =
  | { kind: "unauthenticated" }
  /** Signed in, but this panel isn't theirs. `home` is their own landing route. */
  | { kind: "wrong_role"; home: string }
  /** Clinic suspended / past-due / cancelled / trial expired. */
  | { kind: "clinic_paused" }
  | { kind: "must_change_password" }
  /** Clinic staff with no clinic assigned — unprovisioned. */
  | { kind: "no_clinic" }
  /** Authenticated and in the right panel, but lacks `resource:action`. */
  | { kind: "forbidden" };

type AccessResult =
  | { ok: true; user: CurrentUser }
  | { ok: false; denial: Denial };

/**
 * Evaluates access in the canonical order. Order matters and is preserved exactly as
 * `requireRole`/`requireWorkspace` had it: identity → role → clinic status → password
 * → clinic assignment → permission.
 */
async function checkAccess(
  allowed: UserRole[],
  opts: { requireClinic?: boolean; resource?: string; action?: PermAction } = {},
): Promise<AccessResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, denial: { kind: "unauthenticated" } };

  if (!allowed.includes(user.role)) {
    return { ok: false, denial: { kind: "wrong_role", home: ROLE_HOME_ROUTE[user.role] } };
  }

  // Clinic-level access block (super-admin control plane). getClinic is
  // request-cached, so this adds no query the layout wasn't already running.
  // super_admin has no clinic and is exempt. Impersonation is EXEMPT too — a
  // super-admin often views a clinic BECAUSE it's suspended (support diagnosis).
  if (user.clinicId && user.role !== "super_admin" && !user.impersonation) {
    const clinic = await getClinic(user.clinicId);
    if (clinic && !isClinicUsable(clinic)) {
      return { ok: false, denial: { kind: "clinic_paused" } };
    }
  }

  // A user with a temporary password can't use anything until they change it.
  if (user.mustChangePassword) {
    return { ok: false, denial: { kind: "must_change_password" } };
  }

  if (opts.requireClinic && !user.clinicId) {
    return { ok: false, denial: { kind: "no_clinic" } };
  }

  if (opts.resource && !can(user, opts.resource, opts.action ?? "view")) {
    return { ok: false, denial: { kind: "forbidden" } };
  }

  return { ok: true, user };
}

/** Where a denied PAGE request is sent. */
function redirectTarget(denial: Denial): string {
  switch (denial.kind) {
    case "unauthenticated":
      return "/login";
    case "wrong_role":
      return denial.home;
    case "clinic_paused":
      // /paused uses requireUser, not requireRole, so this never loops.
      return "/paused";
    case "must_change_password":
      return "/change-password";
    case "no_clinic":
      return "/login?error=no_access";
    case "forbidden":
      return "/clinic";
  }
}

/**
 * How a denied API request is answered. 401 means "sign in"; 403 means "signed in,
 * still not allowed". Messages are deliberately non-specific about what exists.
 */
function denialResponse(denial: Denial): Response {
  const [status, error]: [number, string] =
    denial.kind === "unauthenticated"
      ? [401, "Not signed in."]
      : denial.kind === "clinic_paused"
        ? [403, "This clinic's access is paused. Contact your administrator."]
        : denial.kind === "must_change_password"
          ? [403, "Change your password before continuing."]
          : [403, "Not permitted."];
  return Response.json({ error }, { status });
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
  const result = await checkAccess(Array.isArray(allowed) ? allowed : [allowed]);
  if (!result.ok) redirect(redirectTarget(result.denial));
  return result.user;
}

/**
 * Guards a super-admin action/page on a specific ADMIN capability (Feature 9).
 * requireRole("super_admin") first, then the sub-role capability check; a
 * super-admin lacking the capability is bounced to their /admin home. Returns the
 * user so callers can use `admin.id` etc.
 */
export async function requireAdminCapability(
  capability: string,
): Promise<CurrentUser> {
  const user = await requireRole("super_admin");
  if (!canAdmin(user, capability)) redirect("/admin");
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
  const result = await checkAccess(WORKSPACE_ROLES, {
    requireClinic: true,
    resource,
    action,
  });
  if (!result.ok) redirect(redirectTarget(result.denial));
  // requireClinic guarantees this is non-null.
  return { ...result.user, clinicId: result.user.clinicId as string };
}

// ---- API guards: the same rules, answered with a status code ------------

/**
 * The Route-Handler twin of `requireWorkspace`. Runs the IDENTICAL checks (role,
 * clinic status, forced password change, clinic assignment, `resource:action`) and
 * returns a Response instead of redirecting. Use it in every clinic-scoped Route
 * Handler so an API caller can never reach data a page would have refused:
 *
 *   const auth = await apiRequireWorkspace("patients", "view");
 *   if (!auth.ok) return auth.response;
 *   const { user, clinicId } = auth;
 */
export async function apiRequireWorkspace(
  resource?: string,
  action: PermAction = "view",
): Promise<
  | { ok: true; user: CurrentUser; clinicId: string }
  | { ok: false; response: Response }
> {
  const result = await checkAccess(WORKSPACE_ROLES, {
    requireClinic: true,
    resource,
    action,
  });
  if (!result.ok) return { ok: false, response: denialResponse(result.denial) };
  return { ok: true, user: result.user, clinicId: result.user.clinicId as string };
}

/**
 * The Route-Handler twin of `requireAdminCapability` — super_admin plus one admin
 * capability slug, answered with a status code. Note this also applies the
 * forced-password-change gate, which the hand-rolled admin route checks skipped.
 */
export async function apiRequireAdminCapability(
  capability: string,
): Promise<{ ok: true; user: CurrentUser } | { ok: false; response: Response }> {
  const result = await checkAccess(["super_admin"]);
  if (!result.ok) return { ok: false, response: denialResponse(result.denial) };
  if (!canAdmin(result.user, capability)) {
    return { ok: false, response: denialResponse({ kind: "forbidden" }) };
  }
  return { ok: true, user: result.user };
}
