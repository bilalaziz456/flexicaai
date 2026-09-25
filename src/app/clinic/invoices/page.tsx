import { notFound } from "next/navigation";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";
import { getClinic } from "@/core/clinics/get-clinic";

import { Download } from "lucide-react";
import { requireWorkspace } from "@/core/auth/user";
import { clinicHasFeature } from "@/core/lib/features";
import { resolveSalesRange } from "@/core/sales/report";
import { getInvoicesList } from "@/core/billing/invoice";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { InvoiceFilters } from "./invoice-filters";
import { InvoicesTable } from "./invoices-table";
import { Pagination } from "@/core/ui/pagination";
import { pageOffset, parsePage, parsePageSize } from "@/core/lib/pagination";
import { StatCard } from "@/core/ui/charts/stat-card";

const money = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0,
});

/**
 * Invoice register (Finance) — every issued invoice, newest number first, for lookup
 * and reprint (search by invoice #, patient name/phone/MRN, or the old patient number).
 * The invoice number links to its printable page. Gated by the `sales` feature + the
 * `billing` permission; a Finance nav item + a Reports-hub card. Clinic-scoped.
 */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    from?: string;
    to?: string;
    q?: string;
    page?: string;
    size?: string;
  }>;
}) {
  const { clinicId } = await requireWorkspace("billing");
  const clinic = await getClinic(clinicId);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales")) notFound();

  const sp = await searchParams;
  const hasRange = Boolean(sp.period) && sp.period !== "all";
  const range = hasRange ? resolveSalesRange(sp.period, sp.from, sp.to, clinic?.createdAt) : null;
  const q = sp.q?.trim() || "";

  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.size);

  const list = await getInvoicesList(clinicId, {
    from: range?.start,
    toExclusive: range?.end,
    q: q || undefined,
    offset: pageOffset(page, pageSize),
    limit: pageSize,
  });

  const exportParams = new URLSearchParams({ type: "invoices" });
  if (hasRange && range) {
    exportParams.set("period", range.period);
    if (range.period === "custom") {
      exportParams.set("from", range.from);
      exportParams.set("to", range.to);
    }
  }
  if (q) exportParams.set("q", q);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Invoices</h1>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            The numbered invoice register. Search by invoice #, patient name, phone, MRN or patient
            number, and reprint any invoice.
          </p>
        </div>
        {list.rows.length > 0 ? (
          <a
            href={`/api/finance/export?${exportParams.toString()}`}
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            <Download aria-hidden="true" /> CSV
          </a>
        ) : null}
      </div>

      <InvoiceFilters period={range?.period ?? "all"} from={range?.from ?? ""} to={range?.to ?? ""} q={q} />

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Invoices" value={String(list.count)} hint="Issued in this view" />
        <StatCard
          label="Total billed"
          value={money.format(list.totalBilled)}
          hint="Sum of these invoices"
        />
      </div>

      {/* Above the table, matching the drawer history and Trash — the reader decides
          which page to look at before reading rows, not after scrolling past them. */}
      <Pagination
        page={page}
        pageSize={pageSize}
        total={list.count}
        basePath="/clinic/invoices"
        searchParams={{ period: sp.period, from: sp.from, to: sp.to, q, size: sp.size }}
        unit="invoice"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Register</CardTitle>
        </CardHeader>
        <CardContent>
          <InvoicesTable
            rows={list.rows}
            empty={q ? "No invoices match your search." : "No invoices issued yet."}
          />
        </CardContent>
      </Card>
    </div>
  );
}
