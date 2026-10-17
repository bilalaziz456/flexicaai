import { notFound } from "next/navigation";
import { FloatingCreateButton } from "@/core/ui/floating-create-button";
import { asInvoiceState } from "@/core/billing/invoice";
import { can } from "@/core/auth/permissions";
import Link from "next/link";
import { asVisitPaymentStatus } from "@/core/billing/payment-status";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";
import { getClinic } from "@/core/clinics/get-clinic";

import { Download, Plus } from "lucide-react";
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
import { listProcedureCatalog } from "@/core/appointments/procedures";
import { InvoicesTable } from "./invoices-table";
import { Pagination } from "@/core/ui/pagination";
import { pageOffset, parsePage, parsePageSize } from "@/core/lib/pagination";
import { StatCard } from "@/core/ui/charts/stat-card";
import { offeredPapers } from "@/core/lib/print-papers";

const INVOICES_HEADER_SENTINEL_ID = "invoices-header-end";

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
    payment?: string;
    state?: string;
    procedure?: string;
    page?: string;
    size?: string;
  }>;
}) {
  const user = await requireWorkspace("billing");
  const { clinicId } = user;
  const clinic = await getClinic(clinicId);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales")) notFound();

  const sp = await searchParams;
  const hasRange = Boolean(sp.period) && sp.period !== "all";
  const range = hasRange ? resolveSalesRange(sp.period, sp.from, sp.to, clinic?.createdAt) : null;
  const q = sp.q?.trim() || "";
  const payment = asVisitPaymentStatus(sp.payment);
  const state = asInvoiceState(sp.state);
  // The "For" filter: the clinic's procedures AND services, retired ones too (old
  // invoices still carry them). An id that is not this clinic's is dropped, so a stale
  // link shows every invoice rather than none.
  const [procCatalog, svcCatalog] = await Promise.all([
    listProcedureCatalog(clinicId, "procedure"),
    listProcedureCatalog(clinicId, "service"),
  ]);
  const forOptions = [...procCatalog, ...svcCatalog]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ value: p.id, label: `${p.name}${p.isActive ? "" : " (retired)"}` }));
  const procedureId = forOptions.find((o) => o.value === sp.procedure)?.value;

  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.size);

  const list = await getInvoicesList(clinicId, {
    from: range?.start,
    toExclusive: range?.end,
    q: q || undefined,
    payment,
    state,
    procedureId,
    offset: pageOffset(page, pageSize),
    limit: pageSize,
  });

  const canCreate = can(user, "billing", "create") && can(user, "appointments", "create");
  const exportParams = new URLSearchParams({ type: "invoices" });
  if (hasRange && range) {
    exportParams.set("period", range.period);
    if (range.period === "custom") {
      exportParams.set("from", range.from);
      exportParams.set("to", range.to);
    }
  }
  if (q) exportParams.set("q", q);
  if (payment) exportParams.set("payment", payment);
  if (state) exportParams.set("state", state);
  if (procedureId) exportParams.set("procedure", procedureId);

  return (
    <div className="space-y-6">
      {canCreate ? (
        <FloatingCreateButton href="/clinic/invoices/new" label="New invoice" sentinelId={INVOICES_HEADER_SENTINEL_ID} />
      ) : null}
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        {/* What the floating New invoice button watches: once this scrolls out of
            view the header button is gone, so the floating one appears (as on
            Appointments). Absolute, so it takes no space of its own. */}
        <div id={INVOICES_HEADER_SENTINEL_ID} aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px" />
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Invoices</h1>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            The numbered invoice register. Search by invoice #, patient name, phone, MRN or patient
            number, and reprint any invoice.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        {canCreate ? (
          // Hidden on a phone, where the floating button is the create action.
          <Link href="/clinic/invoices/new" data-shortcut="create" aria-keyshortcuts="Alt+C" title="New invoice (Alt+C)" className={cn(buttonVariants(), "hidden sm:inline-flex")}>
            <Plus aria-hidden="true" /> New invoice
          </Link>
        ) : null}
        {list.rows.length > 0 ? (
          <a
            href={`/api/finance/export?${exportParams.toString()}`}
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            <Download aria-hidden="true" /> CSV
          </a>
        ) : null}
        </div>
      </div>

      <InvoiceFilters
        period={range?.period ?? "all"}
        from={range?.from ?? ""}
        to={range?.to ?? ""}
        q={q}
        payment={payment ?? ""}
        state={state ?? ""}
        procedure={procedureId ?? ""}
        forOptions={forOptions}
      />

      {/* Two rows of three: what was BILLED and what is owed on top, the MONEY that
          actually moved underneath. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Invoices" value={String(list.count)} hint="Issued in this view" />
        <StatCard
          label="Total billed"
          value={money.format(list.totalBilled)}
          hint="Sum of these invoices"
        />
        <StatCard
          label="Outstanding"
          value={money.format(list.totalOutstanding)}
          hint="Still owed on these invoices"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Money in"
          value={money.format(list.moneyIn)}
          hint="Payments + advances applied"
        />
        <StatCard label="Refunds" value={money.format(list.refunds)} hint="Money returned" />
        <StatCard label="Net" value={money.format(list.net)} hint="In − refunds" />
      </div>

      {/* Above the table, matching the drawer history and Trash — the reader decides
          which page to look at before reading rows, not after scrolling past them. */}
      <Pagination
        page={page}
        pageSize={pageSize}
        total={list.count}
        basePath="/clinic/invoices"
        searchParams={{ period: sp.period, from: sp.from, to: sp.to, q, payment, state, procedure: procedureId, size: sp.size }}
        unit="invoice"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Register</CardTitle>
        </CardHeader>
        <CardContent>
          <InvoicesTable
            rows={list.rows}
            empty={q || procedureId ? "No invoices match your search." : "No invoices issued yet."}
            canEdit={can(user, "appointments", "edit")}
            canDelete={can(user, "billing", "delete")}
            papers={offeredPapers(clinic?.invoicePapersEnabled)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
