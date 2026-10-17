import {
  Archive,
  BadgeCheck,
  Banknote,
  BellRing,
  CalendarClock,
  CalendarRange,
  CalendarX2,
  ClipboardList,
  ConciergeBell,
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
    newPatientHref: "/clinic/patients/new",
    newAppointmentHref: "/clinic/appointments/new",
    invoiceBase: "/clinic/invoices",
    newInvoiceHref: "/clinic/invoices/new",
    teamBase: "/clinic/staff",
  },
  // Top-level items stay flat; the rest are grouped under collapsible parents.
  nodes: [
    { href: "/clinic", label: "Dashboard", Icon: LayoutDashboard, exact: true },
    { href: "/clinic/appointments", label: "Appointments", Icon: CalendarClock, resource: "appointments", shortcut: "a" },
    { href: "/clinic/patients", label: "Patients", Icon: Contact, resource: "patients", shortcut: "p" },
    { href: "/clinic/scribe", label: "Voice scribe", Icon: Mic, resource: "clinical" },
    // Top level, not under Finance: it now holds appointment and procedure reports
    // as well as the money ones. Shown when the user can open at least one report
    // (`reports/catalog.ts`, computed by the layout).
    { href: "/clinic/reports", label: "Reports", Icon: FileSpreadsheet, gate: "reports" },
    {
      group: "Finance",
      Icon: Wallet,
      items: [
        { href: "/clinic/sales", label: "Sales", Icon: TrendingUp, resource: "sales", feature: "sales" },
        { href: "/clinic/payments", label: "Payments", Icon: HandCoins, resource: "billing", feature: "sales" },
        { href: "/clinic/invoices", label: "Invoices", Icon: FileText, resource: "billing", feature: "sales", shortcut: "i" },
        { href: "/clinic/receivables", label: "Receivables", Icon: HandCoins, resource: "receivables", feature: "sales" },
        { href: "/clinic/discounts", label: "Discounts", Icon: TicketPercent, resource: "discounts", feature: "sales" },
        // NOT feature-gated: shares accrue from consultation fees even without Sales.
        { href: "/clinic/shares", label: "Revenue shares", Icon: PieChart, resource: "shares" },
        { href: "/clinic/expenses", label: "Expenses", Icon: Receipt, resource: "expenses", feature: "finance" },
        // Next to Expenses: both are money leaving the clinic, and the drawer reads
        // the cash half of that ledger.
        { href: "/clinic/cash", label: "Petty cash", Icon: Banknote, resource: "cash", feature: "finance" },
        { href: "/clinic/pl", label: "Profit & Loss", Icon: Wallet, resource: "finance", feature: "finance" },
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
        { href: "/clinic/services", label: "Services", Icon: ConciergeBell, resource: "services", feature: "sales" },
        { href: "/clinic/schedule", label: "Doctor schedule", Icon: CalendarRange, resource: "schedule" },
        { href: "/clinic/no-shows", label: "No-shows", Icon: CalendarX2, resource: "appointments" },
        { href: "/clinic/whatsapp", label: "WhatsApp", Icon: MessageCircle, resource: "whatsapp" },
        { href: "/clinic/recalls", label: "Recalls", Icon: BellRing, resource: "recalls" },
      ],
    },
    {
      group: "Admin",
      Icon: Users,
      items: [
        { href: "/clinic/staff", label: "Team", Icon: Users, resource: "staff" },
        { href: "/clinic/settings", label: "Settings", Icon: Settings },
        { href: "/clinic/trash", label: "Trash", Icon: Trash2, resource: "trash" },
        // Only when the super admin granted this clinic log access.
        { href: "/clinic/logs", label: "Activity log", Icon: ScrollText, gate: "logs" },
      ],
    },
  ],
};
