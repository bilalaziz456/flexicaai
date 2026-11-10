import { FileText } from "lucide-react";
import { listClinicOptionsWithPrice } from "@/core/clinics/options";

import Link from "next/link";
import { requireAdminCapability } from "@/core/auth/user";
import { canAdmin, canManageTeam } from "@/core/auth/admin-permissions";
import {
  getCompanyInvoiceSettings,
  invoicedTotal,
  invoicedTrend,
  listClinicInvoices,
} from "@/core/admin/clinic-invoices";
import {
  formatIsoDay,
  formatPeriod,
  invoiceStatus,
  invoiceStatusLabel,
  invoiceStatusTone,
  isInvoiceStatusFilter,
  localIsoDate,
} from "@/core/admin/invoice-status";
import { Badge } from "@/core/ui/badge";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";
import { resolveSalesRange } from "@/core/sales/report";
import { EmptyState } from "@/core/ui/empty-state";
import { LollipopChart } from "@/core/ui/charts/lollipop-chart";
import { StatCard } from "@/core/ui/charts/stat-card";
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
import { IssueInvoiceForm, InvoiceRowMenu, InvoiceTaxSettingsForm } from "./invoice-ui";

const rs = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;
const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/**
 * Owner Finance — clinic subscription invoices (Phase 4). Invoices FlexicaAI issues to
 * clinics for their subscription: filters (clinic/period/payment status/Trash),
 * invoiced + still-to-be-paid KPIs, a monthly trend graph, an issue form (pre-fills
 * the clinic's monthly price), and a ledger showing each invoice's status (Paid /
 * Partly paid / Unpaid / Overdue — from the payments recorded against it, owner's
 * call 2026-11-11) with print, Record payment and void/restore.
 *
 * Gated by `sub_invoices:view`; issue `sub_invoices:create`, edit `sub_invoices:edit`,
 * void `sub_invoices:delete`,
 * Record payment `billing:create`. A team member who is not a full admin sees only the
 * clinics they manage — the same scope as the clinic pages themselves.
 */
export default async function ClinicInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string; clinicId?: string; status?: string; deleted?: string; page?: string; size?: string }>;
}) {
  const user = await requireAdminCapability("sub_invoices:view");
  const canCreate = canAdmin(user, "sub_invoices:create");
  const canEdit = canAdmin(user, "sub_invoices:edit");
  const canDelete = canAdmin(user, "sub_invoices:delete");
  const canRecordPayment = canAdmin(user, "billing:create");
  const seesAll = canManageTeam(user);
  const scope = seesAll ? {} : { assignedTo: user.id };

  const sp = await searchParams;
  const range = resolveSalesRange(sp.period ?? "year", sp.from, sp.to);
  const deleted = sp.deleted === "1";
  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.size);

  const status = isInvoiceStatusFilter(sp.status) ? sp.status : undefined;
  const today = localIsoDate(new Date());

  const clinicList = await listClinicOptionsWithPrice(scope);

  const [{ rows, total, summary }, invTotal, trend, company] = await Promise.all([
    listClinicInvoices({
      ...scope,
      clinicId: sp.clinicId || undefined,
      from: range.start,
      toExclusive: range.end,
      status,
      deleted,
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
    invoicedTotal(range.start, range.end, scope),
    invoicedTrend(range, scope),
    getCompanyInvoiceSettings(),
  ]);
  const taxDefaults = { label: company.taxLabel, rate: company.taxRate };

  const rangeLabel = `${formatIsoDay(range.from)} – ${formatIsoDay(range.to)}`;
  const hasTrend = trend.some((b) => b.total > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Company finance: subscription invoices</h1>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">Invoices FlexicaAI issues to clinics for their subscription.</p>
      </div>

      <InvoiceFilters
        period={range.period}
        from={range.from}
        to={range.to}
        clinicId={sp.clinicId ?? ""}
        status={status ?? ""}
        deleted={deleted}
        clinics={clinicList}
      />

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="grid gap-3">
          <StatCard
            label="Invoiced"
            value={rs(invTotal.total)}
            hint={`${seesAll ? "" : "Your clinics · "}${invTotal.tax > 0 ? `incl. ${rs(invTotal.tax)} tax · ` : ""}${rangeLabel}`}
          />
          {/* Over the invoices LISTED (period, clinic and status filters applied), so
              the figure always describes the table below it. */}
          <StatCard
            label="Still to be paid"
            value={rs(summary.outstanding)}
            tone={summary.outstanding > 0 ? "bad" : "default"}
            hint={
              summary.overdueCount > 0
                ? `${summary.overdueCount} overdue · ${rs(summary.overdueAmount)}`
                : "Nothing overdue"
            }
          />
        </div>
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">Invoiced over time</CardTitle></CardHeader>
          <CardContent>
            {/* Stems, not an area. An invoice is ISSUED on a day — the total does not
                flow from one month into the next, and an area drawn through these
                points would describe a continuity that is not there. Same encoding as
                the rankings, turned ninety degrees. */}
            {hasTrend ? (
              <LollipopChart
                orientation="vertical"
                rows={trend.map((b) => ({ label: b.label, value: b.total }))}
                ariaLabel="Invoiced over time"
              />
            ) : (
              <EmptyState
                compact
                icon={FileText}
                title="Nothing to chart yet"
                description="The trend needs at least one invoice issued in this period."
              />
            )}
          </CardContent>
        </Card>
      </div>

      {canCreate ? (
        <Card>
          <CardHeader>
            <CardTitle>Issue an invoice</CardTitle>
            <CardDescription>Picking a clinic pre-fills its monthly price. Adjust it for the period charged.</CardDescription>
          </CardHeader>
          <CardContent>
            <IssueInvoiceForm clinics={clinicList} taxDefaults={taxDefaults} />
          </CardContent>
        </Card>
      ) : null}

      {/* Company-wide, so full admins only. */}
      {seesAll && canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>Tax on invoices</CardTitle>
            <CardDescription>
              What &ldquo;Add tax&rdquo; starts from, and the registration numbers printed on an
              invoice that carries tax. Which tax applies, and its rate, depends on our registration and the
              clinic&rsquo;s province: confirm with your tax adviser. Changing this never alters an
              invoice already issued.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InvoiceTaxSettingsForm taxLabel={company.taxLabel} taxRate={company.taxRate} ntn={company.ntn} strn={company.strn} />
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
            <EmptyState
              compact
              icon={FileText}
              title={deleted ? "No voided invoices" : "No invoices match"}
              description={
                deleted
                  ? "A voided invoice keeps its number, so the sequence never has a gap."
                  : "Try a wider period, or clear the filters above."
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Clinic</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const st = invoiceStatus(r.total, r.paid, r.dueOn, today);
                  return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {r.label}
                      {/* A corrected invoice says so: the clinic may hold the earlier printout. */}
                      {r.updatedAt ? (
                        <div
                          className="text-[11px] font-normal text-muted-foreground"
                          title={r.updatedByName ? `Edited by ${r.updatedByName}` : undefined}
                        >
                          Edited {fmtDate(r.updatedAt)}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>{r.clinicName}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{formatPeriod(r.periodStart, r.periodEnd) ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{fmtDate(r.issuedAt)}</TableCell>
                    <TableCell className={st.overdue && !r.deleted ? "whitespace-nowrap text-sm font-medium text-destructive" : "whitespace-nowrap text-sm"}>
                      {r.dueOn ? formatIsoDay(r.dueOn) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {rs(r.total)}
                      {r.taxAmount > 0 ? (
                        <div className="text-[11px] text-muted-foreground" title={`${rs(r.amount)} + ${r.taxLabel ?? "tax"}`}>
                          incl. {rs(r.taxAmount)} tax
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{r.paid !== 0 ? rs(r.paid) : "—"}</TableCell>
                    <TableCell className={st.balance > 0 ? "text-right font-medium tabular-nums" : "text-right tabular-nums text-muted-foreground"}>
                      {st.balance > 0 ? rs(st.balance) : st.overpaid > 0 ? `${rs(st.overpaid)} over` : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {r.deleted ? <Badge variant="outline">Voided</Badge> : <Badge variant={invoiceStatusTone(st)}>{invoiceStatusLabel(st)}</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-3">
                        {/* Opens the clinic's billing card with the payment form filled
                            in for this invoice; the payment is then linked to it. */}
                        {!r.deleted && canRecordPayment && st.balance > 0 ? (
                          <Link
                            href={`/admin/clinics/${r.clinicId}?invoice=${r.id}#billing`}
                            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 whitespace-nowrap text-xs")}
                          >
                            Record payment
                          </Link>
                        ) : null}
                        <InvoiceRowMenu
                          invoice={{
                            id: r.id,
                            label: r.label,
                            clinicName: r.clinicName,
                            amount: r.amount,
                            taxLabel: r.taxLabel,
                            taxRate: r.taxRate,
                            paid: r.paid,
                            periodStart: r.periodStart,
                            periodEnd: r.periodEnd,
                            dueOn: r.dueOn,
                            note: r.note,
                          }}
                          taxDefaults={taxDefaults}
                          deleted={r.deleted}
                          canEdit={canEdit}
                          canDelete={canDelete}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <Pagination page={page} pageSize={pageSize} total={total} basePath="/admin/finance/invoices" searchParams={sp} unit="invoice" />
        </CardContent>
      </Card>
    </div>
  );
}
