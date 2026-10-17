"use client";

import { paymentStatusBadge, visitPaymentStatus } from "@/core/billing/payment-status";
import { Badge } from "@/core/ui/badge";
import Link from "next/link";
import { ChevronDown, Download, Pencil, Printer } from "lucide-react";
import { DeleteInvoiceButton } from "@/app/clinic/invoices/delete-invoice-button";
import { DataTable, type Column } from "@/core/ui/data-table";
import { ActionMenu } from "@/core/ui/action-menu";
import { downloadDocument } from "@/core/ui/download-link";
import { printDocument } from "@/core/ui/print-links";
import { PRINT_PAPERS } from "@/core/lib/print-papers";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";

const money = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 });
const dayFmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

type Row = {
  id: string;
  label: string;
  issuedAt: Date;
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  issuedByName: string | null;
  amount: number;
  appointmentId: string;
  voided: boolean;
  deleted: { byName: string | null; at: Date; reason: string | null } | null;
  collected: number;
  refunded: number;
  visitStatus: string;
  /** "Consultation, Composite filling, Room (per day)". */
  forText: string;
};

/** The same six payment states as the appointments list (core/billing/payment-status). */
function payBadge(r: Row) {
  const status = visitPaymentStatus({ bill: r.amount, collected: r.collected, refunded: r.refunded, visitStatus: r.visitStatus });
  if (!status) return null;
  return paymentStatusBadge(status, {
    outstanding: Math.max(0, r.amount - r.collected),
    extra: Math.max(0, r.collected - r.amount),
    visitStatus: r.visitStatus,
    formatMoney: (n) => money.format(n),
  });
}

/**
 * Invoice register table (client) — sortable columns + a mobile card view via DataTable.
 *
 * Laid out to READ, not to hold every control (owner's report, 2026-10-18 — six links
 * a row, and the date running into the patient's name): one line of facts per row, a
 * "For" column saying what the visit was for, and the actions as ONE "Print ▾" menu
 * (each paper size + Download) beside two small icons. Same actions as before.
 */
export function InvoicesTable({
  rows,
  empty,
  canEdit,
  canDelete,
  papers,
}: {
  rows: Row[];
  empty: string;
  canEdit: boolean;
  canDelete: boolean;
  /** Paper sizes the clinic prints on (one Print entry each). */
  papers: string[];
}) {
  const offered = PRINT_PAPERS.filter((p) => papers.includes(p.key));
  const columns: Column<Row>[] = [
    {
      id: "invoice",
      header: "Invoice",
      cardTitle: true,
      sortValue: (r) => r.issuedAt.getTime(),
      cell: (r) => (
        <div className="min-w-0">
          <Link
            href={`/clinic/invoices/${r.appointmentId}`}
            className={`font-medium underline-offset-4 hover:underline ${r.voided ? "text-muted-foreground line-through" : ""}`}
          >
            {r.label}
          </Link>
          {/* When and by whom, under the number — one column instead of two. */}
          <span className="block text-xs whitespace-nowrap text-muted-foreground">
            {dayFmt(r.issuedAt)}
            {r.issuedByName ? ` · ${r.issuedByName}` : ""}
          </span>
          {r.deleted ? (
            // Deleted by a person: kept on the register, with who, when and why.
            <span className="block text-xs text-destructive-text">
              Deleted by {r.deleted.byName ?? "someone"}, {dayFmt(r.deleted.at)}
              {r.deleted.reason && r.deleted.reason !== "Deleted" ? ` — ${r.deleted.reason}` : ""}
            </span>
          ) : r.voided ? (
            <span className="block text-xs text-muted-foreground">Void — visit cancelled / no-show</span>
          ) : null}
        </div>
      ),
    },
    {
      id: "patient",
      header: "Patient",
      sortValue: (r) => r.patientName,
      cell: (r) => (
        <div className="min-w-0">
          <Link href={`/clinic/patients/${r.patientId}`} className="font-medium underline-offset-4 hover:underline">
            {r.patientName}
          </Link>
          {r.patientPhone ? <span className="block text-xs text-muted-foreground">{r.patientPhone}</span> : null}
        </div>
      ),
    },
    {
      id: "for",
      header: "For",
      sortValue: (r) => r.forText,
      // Two lines at most; the whole list on hover, so a long bill never widens the row.
      cell: (r) =>
        r.forText ? (
          <span title={r.forText} className="line-clamp-2 max-w-64 text-sm">
            {r.forText}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "amount",
      header: "Amount",
      align: "right",
      sortValue: (r) => r.amount,
      cell: (r) => <span className="font-medium whitespace-nowrap tabular-nums">{money.format(r.amount)}</span>,
    },
    {
      id: "payment",
      header: "Payment",
      // Room after the right-aligned Amount, or the two headings read as one word.
      headerClassName: "pl-6",
      cellClassName: "pl-6",
      sortValue: (r) => r.amount - r.collected,
      cell: (r) => {
        if (r.deleted) return <Badge variant="destructive">Deleted</Badge>;
        const b = payBadge(r);
        return b ? <Badge variant={b.variant}>{b.label}</Badge> : <span className="text-muted-foreground">—</span>;
      },
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (r) => {
        const printHref = `/clinic/invoices/${r.appointmentId}/print`;
        return (
          <div className="flex items-center justify-end gap-1">
            <ActionMenu
              label={`Print or download ${r.label}`}
              trigger={{
                content: (
                  <>
                    <Printer className="size-3.5" aria-hidden="true" /> Print
                    <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
                  </>
                ),
                className: "gap-1",
              }}
              sections={[
                {
                  kind: "actions",
                  label: "Print",
                  items: offered.map((p) => ({
                    label: p.key === "thermal" ? "Thermal" : p.label,
                    icon: <Printer className="size-3.5 text-muted-foreground" aria-hidden="true" />,
                    onSelect: () => printDocument(printHref, p.key),
                  })),
                },
                {
                  kind: "actions",
                  items: [
                    {
                      label: "Download PDF",
                      icon: <Download className="size-3.5 text-muted-foreground" aria-hidden="true" />,
                      onSelect: () => downloadDocument(printHref),
                    },
                  ],
                },
              ]}
            />
            {canEdit && !r.voided ? (
              <Link
                href={`/clinic/invoices/${r.appointmentId}`}
                aria-label={`Edit ${r.label}`}
                title="Edit"
                className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-8")}
              >
                <Pencil className="size-3.5" aria-hidden="true" />
              </Link>
            ) : null}
            {canDelete && !r.deleted ? (
              <DeleteInvoiceButton appointmentId={r.appointmentId} label={r.label} held={r.collected} compact />
            ) : null}
          </div>
        );
      },
    },
  ];
  return <DataTable rows={rows} columns={columns} getRowKey={(r) => r.id} minWidthClassName="min-w-[56rem]" empty={empty} />;
}
