import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";

/**
 * Reports hub (Finance) — a landing that gathers the finance reports the user can
 * access, with CSV export where available. Gated by the sales feature; each card is
 * shown only if the user holds the report's permission.
 */
export default async function ReportsHubPage() {
  const user = await requireWorkspace();
  const { clinicId } = user;
  const [clinic] = await db
    .select({ features: clinics.featuresEnabled })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  const sales = clinicHasFeature(clinic?.features, "sales");
  const finance = clinicHasFeature(clinic?.features, "finance");
  if (!sales) notFound();

  const reports = [
    { show: can(user, "sales", "view"), title: "Sales", desc: "Collected revenue from completed visits.", href: "/clinic/sales" },
    { show: can(user, "discounts", "view"), title: "Discounts", desc: "Every discount, who bears it, approval state.", href: "/clinic/discounts", csv: "discounts" },
    { show: can(user, "shares", "view"), title: "Revenue shares", desc: "Per-doctor earnings, paid and outstanding.", href: "/clinic/shares" },
    { show: can(user, "receivables", "view"), title: "Receivables", desc: "What patients owe on completed visits.", href: "/clinic/receivables", csv: "receivables" },
    { show: can(user, "billing", "view"), title: "Day book", desc: "A day's cash in and out, by method.", href: "/clinic/reports/daybook", csv: "daybook" },
    { show: finance && can(user, "expenses", "view"), title: "Expenses", desc: "The clinic's costs.", href: "/clinic/expenses", csv: "expenses" },
    { show: finance && can(user, "finance", "view"), title: "Profit & Loss", desc: "Revenue − shares − expenses.", href: "/clinic/pl" },
  ].filter((r) => r.show);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Reports</h1>
        <p className="text-sm text-muted-foreground">Finance reports, with CSV export where available.</p>
      </div>

      {reports.length === 0 ? (
        <p className="text-sm text-muted-foreground">You don&apos;t have access to any finance reports.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {reports.map((r) => (
            <Card key={r.title}>
              <CardHeader>
                <CardTitle className="text-base">{r.title}</CardTitle>
                <CardDescription>{r.desc}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-3 text-sm">
                <Link href={r.href} className="font-medium underline underline-offset-4">
                  Open
                </Link>
                {r.csv ? (
                  <a
                    href={`/api/finance/export?type=${r.csv}`}
                    className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  >
                    Download CSV
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
