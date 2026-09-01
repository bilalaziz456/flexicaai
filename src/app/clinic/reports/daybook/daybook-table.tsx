"use client";

import { DataTable, type Column } from "@/core/ui/data-table";
import { paymentMethodLabel } from "@/core/finance/payment-methods";

const money = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 });

type Row = { method: string; collected: number; refunded: number; expenses: number; payouts: number; net: number };

/** Day-book by-method totals (client) — sortable + mobile cards via DataTable. */
export function DaybookTable({ rows }: { rows: Row[] }) {
  const columns: Column<Row>[] = [
    { id: "method", header: "Method", cardTitle: true, sortValue: (r) => r.method, cell: (r) => <span>{paymentMethodLabel(r.method)}</span> },
    { id: "collected", header: "Collected", align: "right", sortValue: (r) => r.collected, cell: (r) => <span className="tabular-nums">{money.format(r.collected)}</span> },
    { id: "refunded", header: "Refunded", align: "right", sortValue: (r) => r.refunded, cell: (r) => <span className="tabular-nums">{money.format(r.refunded)}</span> },
    { id: "expenses", header: "Expenses", align: "right", sortValue: (r) => r.expenses, cell: (r) => <span className="tabular-nums">{money.format(r.expenses)}</span> },
    { id: "payouts", header: "Doctor payouts", align: "right", sortValue: (r) => r.payouts, cell: (r) => <span className="tabular-nums">{money.format(r.payouts)}</span> },
    {
      id: "net",
      header: "Net",
      align: "right",
      sortValue: (r) => r.net,
      cell: (r) => <span className={`font-medium tabular-nums ${r.net < 0 ? "text-destructive" : ""}`}>{money.format(r.net)}</span>,
    },
  ];
  return <DataTable rows={rows} columns={columns} getRowKey={(r) => r.method} minWidthClassName="min-w-[34rem]" empty="No cash movement on this day." />;
}
