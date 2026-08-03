import Link from "next/link";
import { Printer } from "lucide-react";
import { asc, eq } from "drizzle-orm";
import { requireAdminCapability } from "@/core/auth/user";
import { canAdmin } from "@/core/auth/admin-permissions";
import { db } from "@/core/db";
import { notDeleted } from "@/core/db/tenant";
import { clinics } from "@/core/db/schema";
import {
  invoicedTotal,
  invoicedTrend,
  listClinicInvoices,
} from "@/core/admin/clinic-invoices";
import { resolveSalesRange } from "@/core/sales/report";
import { MultiBarChart } from "@/app/clinic/sales/multi-bar-chart";
import { parsePage, parsePageSize, pageOffset } from "@/core/lib/pagination";
import { Pagination } from "@/core/ui/pagination";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/core/ui/table";
import { InvoiceFilters } from "./invoice-filters";
import { IssueInvoiceForm, InvoiceRowActions } from "./invoice-ui";

const rs = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;
const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/**
 * Owner Finance — clinic subscription invoices (Phase 4). Invoices FlexicaAI issues to
 * clinics for their subscription: filters (clinic/period/Trash), an invoiced-total
 * KPI + monthly trend graph, an issue form (pre-fills the clinic's monthly price),
 * and a ledger with a printable receipt + void/restore. Gated by `sub_invoices:view`;
 * issue `sub_invoices:create`, void `sub_invoices:delete`.
 */
export default async function ClinicInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string; clinicId?: string; deleted?: string; page?: string; size?: string }>;
}) {
  const user = await requireAdminCapability("sub_invoices:view");
  const canCreate = canAdmin(user, "sub_invoices:create");
  const canDelete = canAdmin(user, "sub_invoices:delete");

  const sp = await searchParams;
  const range = resolveSalesRange(sp.period ?? "year", sp.from, sp.to);
  const deleted = sp.deleted === "1";
  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.size);

  const clinicList = await db
    .select({ id: clinics.id, name: clinics.name, monthlyPrice: clinics.monthlyPrice })
    .from(clinics)
    .where(notDeleted(clinics.deletedAt))
    .orderBy(asc(clinics.name));

  const [{ rows, total }, invTotal, trend] = await Promise.all([
    listClinicInvoices({
      clinicId: sp.clinicId || undefined,
      from: range.start,
      toExclusive: range.end,
      deleted,
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
    invoicedTotal(range.start, range.end),
    invoicedTrend(range),
  ]);

  const rangeLabel = `${range.from} → ${range.to}`;
  const trendPoints = trend.map((b) => ({ label: b.label, values: { invoiced: b.total } }));
  const hasTrend = trend.some((b) => b.total > 0);
  const period = (s: string | null, e: string | null) =>
    s && e ? `${s} → ${e}` : s ? `from ${s}` : e ? `to ${e}` : "—";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Company finance — subscription invoices</h1>
        <p className="text-sm text-muted-foreground">Invoices FlexicaAI issues to clinics for their subscription.</p>
      </div>

      <InvoiceFilters
        period={range.period}
        from={range.from}
        to={range.to}
        clinicId={sp.clinicId ?? ""}
        deleted={deleted}
        clinics={clinicList}
      />

      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardDescription>Invoiced ({rangeLabel})</CardDescription></CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">{rs(invTotal)}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{total} invoice{total === 1 ? "" : "s"}</div>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">Invoiced over time</CardTitle></CardHeader>
          <CardContent>
            {hasTrend ? (
              <MultiBarChart points={trendPoints} series={[{ key: "invoiced", label: "Invoiced", color: "var(--color-chart-1)" }]} ariaLabel="Invoiced by period" />
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">No invoices in this period yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {canCreate ? (
        <Card>
          <CardHeader>
            <CardTitle>Issue an invoice</CardTitle>
            <CardDescription>Picking a clinic pre-fills its monthly price; adjust for the period charged.</CardDescription>
          </CardHeader>
          <CardContent>
            <IssueInvoiceForm clinics={clinicList} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{deleted ? "Voided invoices" : "Invoices"} ({total})</CardTitle>
          <CardDescription>{rangeLabel}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No {deleted ? "voided " : ""}invoices match.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Clinic</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.label}</TableCell>
                    <TableCell>{r.clinicName}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{period(r.periodStart, r.periodEnd)}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{fmtDate(r.issuedAt)}</TableCell>
                    <TableCell className="text-right tabular-nums">{rs(r.amount)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-3">
                        {!r.deleted ? (
                          <Link href={`/admin/finance/invoices/${r.id}/print`} className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground" prefetch={false}>
                            <Printer className="size-3.5" aria-hidden="true" /> Print
                          </Link>
                        ) : null}
                        {canDelete ? <InvoiceRowActions id={r.id} deleted={r.deleted} /> : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pagination page={page} pageSize={pageSize} total={total} basePath="/admin/finance/invoices" searchParams={sp} unit="invoice" />
        </CardContent>
      </Card>
    </div>
  );
}
