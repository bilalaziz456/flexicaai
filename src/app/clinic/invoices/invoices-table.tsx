"use client";

import { paymentStatusBadge, visitPaymentStatus } from "@/core/billing/payment-status";
import { Badge } from "@/core/ui/badge";
import Link from "next/link";
import { Pencil, Printer } from "lucide-react";
import { DeleteInvoiceButton } from "@/app/clinic/invoices/delete-invoice-button";
import { DataTable, type Column } from "@/core/ui/data-table";
import { DownloadLink } from "@/core/ui/download-link";

const money = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 });
const dayFmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

type Row = {
  id: string;
  label: string;
  issuedAt: Date;
  patientId: string;
  patientName: string;
  issuedByName: string | null;
  amount: number;
  appointmentId: string;
  voided: boolean;
  deleted: { byName: string | null; at: Date; reason: string | null } | null;
  collected: number;
  refunded: number;
  visitStatus: string;
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

/** Invoice register table (client) — sortable columns + a mobile card view via DataTable. */
export function InvoicesTable({
  rows,
  empty,
  canEdit,
  canDelete,
}: {
  rows: Row[];
  empty: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const columns: Column<Row>[] = [
    {
      id: "invoice",
      header: "Invoice",
      cardTitle: true,
      sortValue: (r) => r.label,
      cell: (r) => (
        <div>
          <Link
            href={`/clinic/invoices/${r.appointmentId}`}
            className={`font-medium underline underline-offset-4 ${r.voided ? "text-muted-foreground line-through" : ""}`}
          >
            {r.label}
          </Link>
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
    { id: "date", header: "Date", sortValue: (r) => r.issuedAt.getTime(), cell: (r) => <span className="whitespace-nowrap">{dayFmt(r.issuedAt)}</span> },
    {
      id: "patient",
      header: "Patient",
      sortValue: (r) => r.patientName,
      cell: (r) => (
        <Link href={`/clinic/patients/${r.patientId}`} className="underline underline-offset-4">
          {r.patientName}
        </Link>
      ),
    },
    { id: "by", header: "Issued by", sortValue: (r) => r.issuedByName ?? "", cell: (r) => <span className="text-muted-foreground">{r.issuedByName ?? "—"}</span> },
    { id: "amount", header: "Amount", align: "right", sortValue: (r) => r.amount, cell: (r) => <span className="tabular-nums">{money.format(r.amount)}</span> },
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
      header: "Actions",
      align: "right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-3">
          <Link
            href={`/clinic/invoices/${r.appointmentId}/print`}
            className="inline-flex min-h-6 items-center gap-1 text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            <Printer className="size-3.5" aria-hidden="true" /> Print
          </Link>
          <DownloadLink href={`/clinic/invoices/${r.appointmentId}/print`} className="min-h-6 gap-1 font-normal text-muted-foreground underline hover:text-foreground" />
          {canEdit && !r.voided ? (
            <Link
              href={`/clinic/invoices/${r.appointmentId}`}
              className="inline-flex min-h-6 items-center gap-1 text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              <Pencil className="size-3.5" aria-hidden="true" /> Edit
            </Link>
          ) : null}
          {canDelete && !r.deleted ? (
            <DeleteInvoiceButton appointmentId={r.appointmentId} label={r.label} held={r.collected} compact />
          ) : null}
        </div>
      ),
    },
  ];
  return <DataTable rows={rows} columns={columns} getRowKey={(r) => r.id} minWidthClassName="min-w-[62rem]" empty={empty} />;
}
