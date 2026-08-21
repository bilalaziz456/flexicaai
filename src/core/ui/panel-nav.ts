import type { LucideIcon } from "lucide-react";

/**
 * The navigation CONTRACT — CORE, and deliberately just a shape.
 *
 * `PanelShell` renders whatever nav it is handed; it does not know what routes
 * exist. Each panel owns its own map (`app/clinic/nav.ts`, `app/admin/nav.ts`),
 * which is the right way round: adding a page to the clinic workspace should touch
 * the clinic workspace, not a shared component in `core/ui` (ADR-019, delta D-05).
 *
 * Gating is DATA, not code. An item declares what it needs — a permission
 * `resource`, an admin `cap`, a clinic `feature`, or a named `gate` — and the shell
 * applies those uniformly. Before this, the shell carried a `visible()` function
 * with seven hardcoded `/clinic/...` hrefs in it, so every new gated page meant
 * editing shared chrome.
 */

export type NavItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
  /** Match the path exactly (for a section root that would otherwise always be active). */
  exact?: boolean;
  /** Permission resource (`resource:action`); hidden if the user can't access it. */
  resource?: string;
  /** Admin capability slug; hidden if the super-admin sub-role lacks it. */
  cap?: string;
  /** Clinic feature flag (`sales` / `finance`); hidden unless the clinic has it. */
  feature?: string;
  /** A named boolean the panel computes per request (e.g. `logs`, `approvals`). */
  gate?: string;
};

/** A collapsible parent tab that groups related items under a ">" disclosure. */
export type NavGroup = { group: string; Icon: LucideIcon; items: NavItem[] };

export type NavNode = NavItem | NavGroup;

export const isNavGroup = (n: NavNode): n is NavGroup => "group" in n;

/** Where the global search box sends its results; null = no search in this panel. */
export type PanelSearch = {
  patientBase: string;
  appointmentBase: string;
  documentPages: boolean;
};

export type PanelNav = {
  /** Where the logo links. */
  brand: string;
  nodes: NavNode[];
  search: PanelSearch | null;
};
