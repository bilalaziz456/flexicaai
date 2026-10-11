"use client";

import { paymentStatusBadge, visitPaymentStatus } from "@/core/billing/payment-status";
import { Badge } from "@/core/ui/badge";
import Link from "next/link";
import { Printer } from "lucide-react";
import { DataTable, type Column } from "@/core/ui/data-table";

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
    visitStatus: r.visitStatus,
    formatMoney: (n) => money.format(n),
  });
}

/** Invoice register table (client) — sortable columns + a mobile card view via DataTable. */
export function InvoicesTable({ rows, empty }: { rows: Row[]; empty: string }) {
  const columns: Column<Row>[] = [
    { id: "invoice", header: "Invoice", cardTitle: true, sortValue: (r) => r.label, cell: (r) =>
      r.voided ? (
        // The visit was cancelled or became a no-show: the number stays, marked.
        <span className="font-medium text-muted-foreground line-through" title="Void — the visit was cancelled or became a no-show">
          {r.label} <span className="no-underline">· Void</span>
        </span>
      ) : (
        <span className="font-medium">{r.label}</span>
      ) },
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
        const b = payBadge(r);
        return b ? <Badge variant={b.variant}>{b.label}</Badge> : <span className="text-muted-foreground">—</span>;
      },
    },
    {
      id: "print",
      header: "Print",
      align: "right",
      cell: (r) => (
        <Link
          href={`/clinic/appointments/${r.appointmentId}/invoice`}
          className="inline-flex min-h-6 items-center gap-1 text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          <Printer className="size-3.5" aria-hidden="true" /> Print
        </Link>
      ),
    },
  ];
  return <DataTable rows={rows} columns={columns} getRowKey={(r) => r.id} minWidthClassName="min-w-[54rem]" empty={empty} />;
}
