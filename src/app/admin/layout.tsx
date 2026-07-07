import type { ReactNode } from "react";
import { requireRole } from "@/core/auth/user";
import { getThemeCookie } from "@/core/theme/server";
import { PanelShell } from "@/core/ui/panel-shell";

/**
 * Super Admin panel shell. Guards EVERY /admin/* route to super_admin — if a
 * non-super-admin reaches here, requireRole redirects them to their own panel.
 * Specialty-agnostic: the company panel manages clinics + modules generically.
 * The responsive chrome (sidebar / hamburger) is the shared PanelShell.
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireRole("super_admin");
  const theme = await getThemeCookie();

  return (
    <PanelShell panel="admin" identityLabel={user.username} theme={theme}>
      {children}
    </PanelShell>
  );
}
