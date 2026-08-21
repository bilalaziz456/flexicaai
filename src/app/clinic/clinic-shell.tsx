"use client";

import { PanelShell, type PanelShellProps } from "@/core/ui/panel-shell";
import { CLINIC_NAV } from "@/app/clinic/nav";

/**
 * The clinic workspace's chrome: the shared `PanelShell` with THIS panel's nav.
 *
 * WHY A WRAPPER RATHER THAN THE LAYOUT PASSING THE NAV: nav items carry Lucide
 * component references, and a function can't cross the server→client boundary as a
 * prop. The layout is a Server Component, so it can't hand `CLINIC_NAV` to a client
 * component — but a client component CAN import it. Hence this: three lines that
 * turn "the shell owns every route in the app" into "each panel owns its own"
 * (ADR-019, delta D-05). Everything else the layout passes is serializable and flows
 * straight through.
 */
export function ClinicShell(props: Omit<PanelShellProps, "nav">) {
  return <PanelShell nav={CLINIC_NAV} {...props} />;
}
