import type { ReactNode } from "react";
import { requireRole } from "@/core/auth/user";
import { getThemeCookie } from "@/core/theme/server";
import { AdminShell } from "./admin-shell";

/**
 * Super Admin panel shell. Guards EVERY /admin/* route to super_admin — if a
 * non-super-admin reaches here, requireRole redirects them to their own panel.
 * Specialty-agnostic: the company panel manages clinics + modules generically.
 * The responsive chrome (desktop sidebar / mobile hamburger) lives in AdminShell.
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireRole("super_admin");
  const theme = await getThemeCookie();

  return (
    <AdminShell username={user.username} theme={theme}>
      {children}
    </AdminShell>
  );
}
