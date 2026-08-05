"use client";

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
};

/** Invoice register table (client) — sortable columns + a mobile card view via DataTable. */
export function InvoicesTable({ rows, empty }: { rows: Row[]; empty: string }) {
  const columns: Column<Row>[] = [
    { id: "invoice", header: "Invoice", cardTitle: true, sortValue: (r) => r.label, cell: (r) => <span className="font-medium">{r.label}</span> },
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
  return <DataTable rows={rows} columns={columns} getRowKey={(r) => r.id} minWidthClassName="min-w-[44rem]" empty={empty} />;
}
