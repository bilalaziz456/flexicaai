"use client";

import Link from "next/link";
import { Printer } from "lucide-react";
import { DataTable, type Column } from "@/core/ui/data-table";

const money = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 });
const dayFmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const KIND_LABEL: Record<string, string> = {
  payment: "Payment",
  advance: "Advance",
  advance_applied: "Advance applied",
  refund: "Refund",
};
// Mirrors payments-ledger.ts#isMoneyOut (that module is server-only — can't import here).
const isMoneyOut = (kind: string) => kind === "refund";

type Row = {
  id: string;
  receiptLabel: string | null;
  occurredAt: Date;
  patientId: string;
  patientName: string;
  doctorName: string | null;
  kind: string;
  method: string | null;
  createdByName: string | null;
  amount: number;
  appointmentId: string | null;
};

/** Payments ledger table (client) — sortable columns + a mobile card view via DataTable. */
export function PaymentsTable({ rows, empty }: { rows: Row[]; empty: string }) {
  const columns: Column<Row>[] = [
    { id: "receipt", header: "Payment #", sortValue: (r) => r.receiptLabel ?? "", cell: (r) => <span className="font-medium tabular-nums">{r.receiptLabel ?? "—"}</span> },
    { id: "date", header: "Date", cardTitle: true, sortValue: (r) => r.occurredAt.getTime(), cell: (r) => <span className="whitespace-nowrap">{dayFmt(r.occurredAt)}</span> },
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
    { id: "doctor", header: "Doctor", sortValue: (r) => r.doctorName ?? "", cell: (r) => r.doctorName ?? "—" },
    { id: "type", header: "Type", sortValue: (r) => r.kind, cell: (r) => KIND_LABEL[r.kind] ?? r.kind },
    { id: "method", header: "Method", sortValue: (r) => r.method ?? "", cell: (r) => r.method ?? "—" },
    { id: "by", header: "By", cell: (r) => <span className="text-muted-foreground">{r.createdByName ?? "—"}</span> },
    {
      id: "amount",
      header: "Amount",
      align: "right",
      sortValue: (r) => (isMoneyOut(r.kind) ? -r.amount : r.amount),
      cell: (r) => (
        <span className="font-medium tabular-nums">
          {isMoneyOut(r.kind) ? "−" : ""}
          {money.format(r.amount)}
        </span>
      ),
    },
    {
      id: "receiptlink",
      header: "Receipt",
      align: "right",
      cell: (r) =>
        r.appointmentId ? (
          <Link
            href={`/clinic/appointments/${r.appointmentId}/receipt`}
            className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            <Printer className="size-3.5" aria-hidden="true" /> Print
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];
  return <DataTable rows={rows} columns={columns} getRowKey={(r) => r.id} minWidthClassName="min-w-[52rem]" empty={empty} />;
}
