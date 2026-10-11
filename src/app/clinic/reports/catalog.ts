import {
  ArrowLeftRight,
  Banknote,
  BookOpen,
  CalendarDays,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  HandCoins,
  PieChart,
  TicketPercent,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { can } from "@/core/auth/permissions";

export type ReportCard = { title: string; Icon: LucideIcon; desc: string; href: string };

/**
 * Every report, and who may open it — ONE list, read by the Reports page (its cards)
 * and the clinic layout (whether the top-level Reports link shows at all), so the two
 * can never disagree about who has a report to look at.
 *
 * Each entry carries its own feature gate. The page used to 404 without the `sales`
 * feature, so the cards never needed one; Reports is now top level and open to anyone
 * with at least one report, and the Appointments report does not depend on sales.
 */
export function reportsFor(
  user: Parameters<typeof can>[0],
  features: { sales: boolean; finance: boolean },
): ReportCard[] {
  const may = (resource: string) => can(user, resource, "view");
  const { sales, finance } = features;
  const all: (ReportCard & { show: boolean })[] = [
    { show: finance && may("finance"), title: "Overview", Icon: FileSpreadsheet, desc: "The clinic's day end to end. Sales, discounts, shares, cash, profit.", href: "/clinic/reports/overview" },
    { show: may("appointments"), title: "Appointments", Icon: CalendarDays, desc: "Booked, completed, no-shows and cancellations, by doctor, day and hour.", href: "/clinic/reports/appointments" },
    { show: sales && may("appointments"), title: "Procedures", Icon: ClipboardList, desc: "Which procedures were done, how often, for how many patients, and what they billed.", href: "/clinic/reports/procedures" },
    { show: sales && may("sales"), title: "Sales", Icon: TrendingUp, desc: "Collected revenue from completed visits.", href: "/clinic/sales" },
    { show: sales && may("discounts"), title: "Discounts", Icon: TicketPercent, desc: "Every discount, who bears it, approval state.", href: "/clinic/discounts" },
    // Not feature-gated, like its nav item: shares accrue from consultation fees too.
    { show: may("shares"), title: "Revenue shares", Icon: PieChart, desc: "Per-doctor earnings, paid and outstanding.", href: "/clinic/shares" },
    { show: sales && may("receivables"), title: "Receivables", Icon: HandCoins, desc: "What patients owe on completed visits.", href: "/clinic/receivables" },
    { show: sales && may("billing"), title: "Payments", Icon: ArrowLeftRight, desc: "Every payment, advance, and refund. Money in and out.", href: "/clinic/payments" },
    { show: sales && may("billing"), title: "Invoices", Icon: FileText, desc: "The numbered invoice register. Look up & reprint.", href: "/clinic/invoices" },
    { show: sales && may("billing"), title: "Day book", Icon: BookOpen, desc: "A day's cash in and out, by method.", href: "/clinic/reports/daybook" },
    { show: finance && may("expenses"), title: "Expenses", Icon: Banknote, desc: "The clinic's costs.", href: "/clinic/expenses" },
    { show: finance && may("finance"), title: "Profit & Loss", Icon: Wallet, desc: "Revenue − shares − expenses.", href: "/clinic/pl" },
  ];
  return all.filter((r) => r.show).map(({ show: _show, ...card }) => card);
}
