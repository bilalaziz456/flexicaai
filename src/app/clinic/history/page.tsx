import { notFound } from "next/navigation";
import { getClinic } from "@/core/clinics/get-clinic";

import { Archive } from "lucide-react";
import { requireWorkspace } from "@/core/auth/user";
import { clinicHasFeature } from "@/core/lib/features";
import { resolveSalesRange } from "@/core/sales/report";
import {
  getImportedHistorySummary,
  listImportedTransactions,
  HISTORY_TABS,
  type HistoryType,
} from "@/core/finance/imported-history";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/core/ui/card";
import { HistoryFilters } from "./history-filters";
import { HistoryTable } from "./history-table";

const money = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 });

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Imported financial history (read-only archive). A clinic's pre-FlexicaAI bills /
 * receipts / expenses / doctor-payouts, uploaded by the company at onboarding. This is
 * the ONLY page that reads `imported_transactions`; it is deliberately walled off from
 * the live Sales/Payments/Receivables reports so old figures never mix with live ones.
 * Gated by the `sales` feature + `billing` permission. See docs/financial-archive-plan.md.
 */
export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; period?: string; from?: string; to?: string; q?: string }>;
}) {
  const user = await requireWorkspace("billing");
  const { clinicId } = user;

  const clinic = await getClinic(clinicId);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales")) notFound();

  const sp = await searchParams;
  const tab = (HISTORY_TABS.find((t) => t.id === sp.type)?.id ?? "invoice") as HistoryType;
  const tabDef = HISTORY_TABS.find((t) => t.id === tab)!;
  const q = sp.q?.trim() || "";
  const period = sp.period || "all";

  // "all" (default) = no date bound; any other period narrows by transaction date.
  let from: string | undefined;
  let toExclusive: string | undefined;
  let rangeFrom = "";
  let rangeTo = "";
  if (period && period !== "all") {
    const range = resolveSalesRange(period, sp.from, sp.to);
    from = ymd(range.start);
    toExclusive = ymd(range.end);
    rangeFrom = range.from;
    rangeTo = range.to;
  }

  const [summary, list] = await Promise.all([
    getImportedHistorySummary(clinicId),
    listImportedTransactions(clinicId, { types: tabDef.types, from, toExclusive, q: q || undefined, limit: 500 }),
  ]);

  const exportParams = new URLSearchParams({ type: "history", htype: tab, period });
  if (period === "custom") {
    exportParams.set("from", rangeFrom);
    exportParams.set("to", rangeTo);
  }
  if (q) exportParams.set("q", q);

  const cards = [
    { title: "Billed", value: summary.billed, note: "Old invoices" },
    { title: "Collected", value: summary.collected, note: "Payments − refunds" },
    { title: "Outstanding", value: summary.outstanding, note: "Billed − collected" },
    { title: "Expenses", value: summary.expenses, note: "Old clinic costs" },
    { title: "Doctor payouts", value: summary.payouts, note: "Paid to doctors" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">History</h1>
          <p className="text-sm text-muted-foreground">
            Records imported from the clinic&apos;s previous software.
          </p>
        </div>
        {summary.hasAny ? (
          <a
            href={`/api/finance/export?${exportParams.toString()}`}
            className="inline-flex h-9 items-center rounded-lg border px-3 text-sm font-medium hover:bg-accent"
          >
            Export CSV
          </a>
        ) : null}
      </div>

      {/* Unmistakable: these are historical, not live figures. */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
        <Archive className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden="true" />
        <p>
          <span className="font-medium">Historical: imported from previous software, read-only.</span>{" "}
          These figures are a frozen archive for audit and lookup. They are NOT part of your live
          Sales, Payments, or Profit &amp; Loss reports.
        </p>
      </div>

      {!summary.hasAny ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No financial history has been imported for this clinic yet. Your account manager can
            upload it during onboarding.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {cards.map((c) => (
              <Card key={c.title}>
                <CardHeader>
                  <CardDescription>{c.title}</CardDescription>
                  <CardTitle className="text-2xl tabular-nums">{money.format(c.value)}</CardTitle>
                  <CardDescription>{c.note}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>

          <HistoryFilters type={tab} period={period} from={rangeFrom} to={rangeTo} q={q} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {list.total} {tabDef.label.toLowerCase()} · {money.format(list.totalAmount)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <HistoryTable rows={list.rows} tab={tab} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
