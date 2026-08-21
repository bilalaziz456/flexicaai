import {
  Building2,
  FileText,
  LayoutDashboard,
  Megaphone,
  Receipt,
  ScrollText,
  ShieldCheck,
  Trash2,
  TrendingUp,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";
import type { PanelNav } from "@/core/ui/panel-nav";

/**
 * The super-admin (company) panel's navigation — owned by the panel, not by the
 * shared shell (ADR-019).
 *
 * Gating here is by admin CAPABILITY (`users.permissions` admin slugs). The owner
 * has no capability list, which means unrestricted, so every item shows.
 *
 * No `search`: the global search is patient/appointment-oriented and this panel is
 * cross-tenant, so it deliberately has none.
 */
export const ADMIN_NAV: PanelNav = {
  brand: "/admin/overview",
  search: null,
  nodes: [
    { href: "/admin/overview", label: "Overview", Icon: LayoutDashboard, exact: true, cap: "metrics:view" },
    { href: "/admin", label: "Clinics", Icon: Building2, exact: true, cap: "clinics:view" },
    { href: "/admin/logs", label: "Activity log", Icon: ScrollText },
    { href: "/admin/announcements", label: "Announcements", Icon: Megaphone, cap: "announcements:view" },
    { href: "/admin/team", label: "Team", Icon: Users, cap: "team:view" },
    {
      group: "Company finance",
      Icon: Wallet,
      items: [
        { href: "/admin/finance", label: "P&L", Icon: TrendingUp, exact: true, cap: "pnl:view" },
        { href: "/admin/finance/costs", label: "Serving cost", Icon: Wallet, cap: "serving_cost:view" },
        { href: "/admin/finance/expenses", label: "Operating expenses", Icon: Receipt, cap: "expenses:view" },
        { href: "/admin/finance/invoices", label: "Subscription invoices", Icon: FileText, cap: "sub_invoices:view" },
      ],
    },
    { href: "/admin/security", label: "Security", Icon: ShieldCheck },
    { href: "/admin/account", label: "Account settings", Icon: UserCog, cap: "account:view" },
    { href: "/admin/trash", label: "Trash", Icon: Trash2, cap: "clinics:edit" },
  ],
};
