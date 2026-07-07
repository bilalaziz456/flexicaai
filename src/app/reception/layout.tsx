import type { ReactNode } from "react";
import { requireRole } from "@/core/auth/user";
import { getThemeCookie } from "@/core/theme/server";
import { PanelShell } from "@/core/ui/panel-shell";

/**
 * Receptionist panel shell. Same responsive chrome (sidebar / hamburger) as
 * every other role, via the shared PanelShell. Guards to receptionist.
 */
export default async function ReceptionLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireRole("receptionist");
  const theme = await getThemeCookie();

  return (
    <PanelShell panel="reception" identityLabel={user.username} theme={theme}>
      {children}
    </PanelShell>
  );
}
