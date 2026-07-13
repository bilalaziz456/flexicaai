import type { ReactNode } from "react";
import { requireRole } from "@/core/auth/user";
import { accessibleResourceIds } from "@/core/auth/permissions";
import { getThemeCookie } from "@/core/theme/server";
import { PanelShell } from "@/core/ui/panel-shell";

/**
 * Doctor panel shell. Same responsive chrome (sidebar / hamburger) as every
 * other role, via the shared PanelShell. The voice scribe adapts to the
 * clinic's enabled module.
 */
export default async function DoctorLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("doctor");
  const theme = await getThemeCookie();

  return (
    <PanelShell
      panel="doctor"
      identityLabel={user.username}
      theme={theme}
      accessibleResources={accessibleResourceIds(user)}
    >
      {children}
    </PanelShell>
  );
}
