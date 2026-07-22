import type { ReactNode } from "react";
import { requireRole } from "@/core/auth/user";
import { adminCapabilitySet } from "@/core/auth/admin-permissions";
import { getThemeCookie } from "@/core/theme/server";
import { displayStaffName, staffInitials } from "@/core/types/auth";
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
    <PanelShell
      panel="admin"
      identityLabel="Super admin"
      userName={displayStaffName(user.prefix, user.fullName, user.username)}
      userInitials={staffInitials(user.fullName, user.username)}
      accountHref="/admin/account"
      avatarVersion={user.avatarKey ?? "none"}
      theme={theme}
      adminCapabilities={[...adminCapabilitySet(user)]}
    >
      {children}
    </PanelShell>
  );
}
