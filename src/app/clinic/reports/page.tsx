import Link from "next/link";
import {
  ArrowRight,
  Download,
  FileSpreadsheet,
  FileText,
  HandCoins,
  PieChart,
  Receipt,
  TicketPercent,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { getClinic } from "@/core/clinics/get-clinic";
import { notFound } from "next/navigation";

import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { clinicHasFeature } from "@/core/lib/features";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { EmptyState } from "@/core/ui/empty-state";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";

/**
 * Reports hub (Finance) — a landing that gathers the finance reports the user can
 * access, with CSV export where available. Gated by the sales feature; each card is
 * shown only if the user holds the report's permission.
 */
export default async function ReportsHubPage() {
  const user = await requireWorkspace();
  const { clinicId } = user;
  const clinic = await getClinic(clinicId);
  const sales = clinicHasFeature(clinic?.featuresEnabled, "sales");
  const finance = clinicHasFeature(clinic?.featuresEnabled, "finance");
  if (!sales) notFound();

  const reports = [
    { show: finance && can(user, "finance", "view"), title: "Overview", Icon: FileSpreadsheet, desc: "The clinic's day end to end. Sales, discounts, shares, cash, profit.", href: "/clinic/reports/overview" },
    { show: can(user, "sales", "view"), title: "Sales", Icon: TrendingUp, desc: "Collected revenue from completed visits.", href: "/clinic/sales", csv: "sales" },
    { show: can(user, "discounts", "view"), title: "Discounts", Icon: TicketPercent, desc: "Every discount, who bears it, approval state.", href: "/clinic/discounts", csv: "discounts" },
    { show: can(user, "shares", "view"), title: "Revenue shares", Icon: PieChart, desc: "Per-doctor earnings, paid and outstanding.", href: "/clinic/shares", csv: "shares" },
    { show: can(user, "receivables", "view"), title: "Receivables", Icon: HandCoins, desc: "What patients owe on completed visits.", href: "/clinic/receivables", csv: "receivables" },
    { show: can(user, "billing", "view"), title: "Payments", Icon: HandCoins, desc: "Every payment, advance, and refund. Money in and out.", href: "/clinic/payments", csv: "payments" },
    { show: can(user, "billing", "view"), title: "Invoices", Icon: FileText, desc: "The numbered invoice register. Look up & reprint.", href: "/clinic/invoices", csv: "invoices" },
    { show: can(user, "billing", "view"), title: "Day book", Icon: Receipt, desc: "A day's cash in and out, by method.", href: "/clinic/reports/daybook", csv: "daybook" },
    { show: finance && can(user, "expenses", "view"), title: "Expenses", Icon: Receipt, desc: "The clinic's costs.", href: "/clinic/expenses", csv: "expenses" },
    { show: finance && can(user, "finance", "view"), title: "Profit & Loss", Icon: Wallet, desc: "Revenue − shares − expenses.", href: "/clinic/pl", csv: "pl" },
  ].filter((r) => r.show);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Reports</h1>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">Finance reports, with CSV export where available.</p>
      </div>

      {reports.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={FileSpreadsheet}
              title="No reports available to you"
              description="Finance reports open up with the sales, billing or finance permissions. A clinic admin can grant them."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {reports.map((r) => (
            // The whole card opens the report: the title link is "stretched" over the
            // card via an ::after overlay. The CSV link sits above it (relative z-10)
            // so it stays independently clickable.
            <Card
              key={r.title}
              className="group/report relative flex flex-col transition-colors hover:border-primary/45"
            >
              <CardHeader>
                <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary-text">
                  <r.Icon className="size-4.5" aria-hidden="true" />
                </div>
                <CardTitle className="text-base">
                  <Link
                    href={r.href}
                    className="flex items-center gap-1.5 after:absolute after:inset-0 after:rounded-[inherit]"
                  >
                    {r.title}
                    {/* The affordance. A border that changes on hover is only visible
                        to someone already hovering; an arrow says "this opens
                        something" before the pointer arrives, and then moves. */}
                    <ArrowRight
                      className="size-4 text-muted-foreground transition-transform group-hover/report:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </Link>
                </CardTitle>
                <CardDescription>{r.desc}</CardDescription>
              </CardHeader>
              {/* `mt-auto` pins the export to the bottom of every card, so the row of
                  them lines up however long the description ran. Overview has no CSV
                  and renders an empty footer rather than none, which is what keeps it
                  the same height as the two cards beside it. */}
              <CardContent className="mt-auto pt-0">
                {r.csv ? (
                  <a
                    href={`/api/finance/export?type=${r.csv}`}
                    className={cn(
                      buttonVariants({ variant: "outline", size: "sm" }),
                      "relative z-10",
                    )}
                  >
                    <Download aria-hidden="true" />
                    CSV
                  </a>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
