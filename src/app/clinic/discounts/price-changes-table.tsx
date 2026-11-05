"use client";

import Link from "next/link";
import { DataTable, type Column } from "@/core/ui/data-table";

const money = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 });
const dayFmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

type Row = {
  key: string;
  appointmentId: string;
  scheduledAt: Date;
  patientName: string | null;
  doctorName: string | null;
  name: string;
  isService: boolean;
  quantity: number;
  listPrice: number;
  unitPrice: number;
  difference: number;
};

/** Lines charged away from their list price (client) — sortable + mobile cards. */
export function PriceChangesTable({ rows }: { rows: Row[] }) {
  const columns: Column<Row>[] = [
    {
      id: "date",
      header: "Date",
      sortValue: (r) => r.scheduledAt.getTime(),
      cell: (r) => (
        <Link href={`/clinic/appointments/${r.appointmentId}`} className="whitespace-nowrap underline underline-offset-4">
          {dayFmt(r.scheduledAt)}
        </Link>
      ),
    },
    { id: "patient", header: "Patient", cardTitle: true, sortValue: (r) => r.patientName ?? "", cell: (r) => r.patientName ?? "—" },
    { id: "doctor", header: "Doctor", sortValue: (r) => r.doctorName ?? "", cell: (r) => r.doctorName ?? "—" },
    {
      id: "item",
      header: "Item",
      sortValue: (r) => r.name,
      cell: (r) => (
        <span className="whitespace-nowrap">
          {r.name}
          {r.quantity > 1 ? <span className="text-muted-foreground"> × {r.quantity}</span> : null}
          {r.isService ? <span className="block text-xs text-muted-foreground">Service</span> : null}
        </span>
      ),
    },
    { id: "list", header: "List price", align: "right", sortValue: (r) => r.listPrice, cell: (r) => <span className="tabular-nums">{money.format(r.listPrice)}</span> },
    { id: "charged", header: "Charged", align: "right", sortValue: (r) => r.unitPrice, cell: (r) => <span className="tabular-nums">{money.format(r.unitPrice)}</span> },
    {
      id: "difference",
      header: "Difference",
      align: "right",
      sortValue: (r) => r.difference,
      cell: (r) => (
        // Signed and worded, so the direction never rests on colour alone.
        <span className="font-medium tabular-nums">
          {r.difference > 0 ? "+" : "−"}
          {money.format(Math.abs(r.difference))}
        </span>
      ),
    },
  ];
  return <DataTable rows={rows} columns={columns} getRowKey={(r) => r.key} minWidthClassName="min-w-[44rem]" empty="No prices were changed in this period." />;
}
