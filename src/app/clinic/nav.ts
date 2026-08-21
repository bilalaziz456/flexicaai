import {
  Archive,
  BadgeCheck,
  BellRing,
  CalendarClock,
  CalendarX2,
  ClipboardList,
  Contact,
  FileSpreadsheet,
  FileText,
  HandCoins,
  LayoutDashboard,
  MessageCircle,
  Mic,
  PieChart,
  Receipt,
  ScrollText,
  Settings,
  TicketPercent,
  Trash2,
  TrendingUp,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";
import type { PanelNav } from "@/core/ui/panel-nav";

/**
 * The clinic workspace's navigation — owned by the workspace, not by the shared
 * shell (ADR-019). Adding a page here is a change to this file only.
 *
 * Every item declares its own gating, and `PanelShell` applies it uniformly:
 *   `resource` — the per-user permission needed (see core/auth/permissions.ts)
 *   `feature`  — the clinic feature the super admin must have enabled
 *   `gate`     — a boolean the layout computes per request
 * An item with none of these is visible to every clinic user.
 */
export const CLINIC_NAV: PanelNav = {
  brand: "/clinic",
  search: {
    patientBase: "/clinic/patients",
    appointmentBase: "/clinic/appointments",
    documentPages: true,
  },
  // Top-level items stay flat; the rest are grouped under collapsible parents.
  nodes: [
    { href: "/clinic", label: "Dashboard", Icon: LayoutDashboard, exact: true },
    { href: "/clinic/appointments", label: "Appointments", Icon: CalendarClock, resource: "appointments" },
    { href: "/clinic/patients", label: "Patients", Icon: Contact, resource: "patients" },
    { href: "/clinic/scribe", label: "Voice scribe", Icon: Mic, resource: "clinical" },
    {
      group: "Finance",
      Icon: Wallet,
      items: [
        { href: "/clinic/sales", label: "Sales", Icon: TrendingUp, resource: "sales", feature: "sales" },
        { href: "/clinic/payments", label: "Payments", Icon: HandCoins, resource: "billing", feature: "sales" },
        { href: "/clinic/invoices", label: "Invoices", Icon: FileText, resource: "billing", feature: "sales" },
        { href: "/clinic/receivables", label: "Receivables", Icon: HandCoins, resource: "receivables", feature: "sales" },
        { href: "/clinic/discounts", label: "Discounts", Icon: TicketPercent, resource: "discounts", feature: "sales" },
        // NOT feature-gated: shares accrue from consultation fees even without Sales.
        { href: "/clinic/shares", label: "Revenue shares", Icon: PieChart, resource: "shares" },
        { href: "/clinic/expenses", label: "Expenses", Icon: Receipt, resource: "expenses", feature: "finance" },
        { href: "/clinic/pl", label: "Profit & Loss", Icon: Wallet, resource: "finance", feature: "finance" },
        // The hub gates each card itself, so it needs no resource of its own.
        { href: "/clinic/reports", label: "Reports", Icon: FileSpreadsheet, feature: "sales" },
        { href: "/clinic/history", label: "History", Icon: Archive, resource: "billing", feature: "sales" },
        // Shown to potential approvers — a doctor, or anyone holding the capability.
        { href: "/clinic/approvals", label: "Discount approvals", Icon: BadgeCheck, gate: "approvals" },
      ],
    },
    {
      group: "Operations",
      Icon: ClipboardList,
      items: [
        { href: "/clinic/procedures", label: "Procedures", Icon: ClipboardList, resource: "procedures", feature: "sales" },
        { href: "/clinic/doctors", label: "Doctors", Icon: UserCog, resource: "leave" },
        { href: "/clinic/no-shows", label: "No-shows", Icon: CalendarX2, resource: "appointments" },
        { href: "/clinic/whatsapp", label: "WhatsApp", Icon: MessageCircle, resource: "whatsapp" },
        { href: "/clinic/recalls", label: "Recalls", Icon: BellRing, resource: "recalls" },
      ],
    },
    {
      group: "Admin",
      Icon: Users,
      items: [
        { href: "/clinic/staff", label: "Staff", Icon: Users, resource: "staff" },
        { href: "/clinic/settings", label: "Settings", Icon: Settings },
        { href: "/clinic/trash", label: "Trash", Icon: Trash2, resource: "trash" },
        // Only when the super admin granted this clinic log access.
        { href: "/clinic/logs", label: "Activity log", Icon: ScrollText, gate: "logs" },
      ],
    },
  ],
};
