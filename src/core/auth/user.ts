import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/core/db/client.server";
import {
  isUserRole,
  ROLE_HOME_ROUTE,
  type CurrentUser,
  type UserRole,
} from "@/core/types/auth";

/**
 * Reads the authenticated user for Server Components, Server Actions, and Route
 * Handlers. Returns null when signed out.
 *
 * Role and clinicId come from app_metadata (tamper-proof, admin-controlled).
 * The `users` table (Step 3) will hold the fuller profile; this helper is the
 * one place to update when that becomes the source of truth for extra fields.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const rawRole = user.app_metadata?.role;
  const clinicId = user.app_metadata?.clinic_id;

  return {
    id: user.id,
    email: user.email ?? null,
    role: isUserRole(rawRole) ? rawRole : null,
    clinicId: typeof clinicId === "string" ? clinicId : null,
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
 * Redirects to the user's own home if their role isn't allowed, or to /login
 * if signed out / not yet provisioned with a role.
 */
export async function requireRole(
  allowed: UserRole | UserRole[],
): Promise<CurrentUser> {
  const user = await requireUser();
  const allowedRoles = Array.isArray(allowed) ? allowed : [allowed];

  if (!user.role) redirect("/login?error=no_access");
  if (!allowedRoles.includes(user.role)) {
    redirect(ROLE_HOME_ROUTE[user.role]);
  }
  return user;
}
