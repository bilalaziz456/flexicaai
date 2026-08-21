"use client";

import { PanelShell, type PanelShellProps } from "@/core/ui/panel-shell";
import { ADMIN_NAV } from "@/app/admin/nav";

/**
 * The company panel's chrome: the shared `PanelShell` with THIS panel's nav.
 * See `app/clinic/clinic-shell.tsx` for why the nav is imported here rather than
 * passed down from the (server) layout.
 */
export function AdminShell(props: Omit<PanelShellProps, "nav">) {
  return <PanelShell nav={ADMIN_NAV} {...props} />;
}
