"use client";

import { DataTable, type Column } from "@/core/ui/data-table";

const money = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 });

type Bucket = { label: string; revenue: number; share: number; expense: number; profit: number };

/** P&L by-period table (client) — sortable amount columns + a mobile card view. */
export function PlByPeriodTable({ rows }: { rows: Bucket[] }) {
  const columns: Column<Bucket>[] = [
    { id: "period", header: "Period", cardTitle: true, cell: (b) => b.label },
    { id: "revenue", header: "Revenue", align: "right", sortValue: (b) => b.revenue, cell: (b) => <span className="tabular-nums">{money.format(b.revenue)}</span> },
    { id: "costs", header: "Costs", align: "right", sortValue: (b) => b.share + b.expense, cell: (b) => <span className="tabular-nums">{money.format(b.share + b.expense)}</span> },
    {
      id: "profit",
      header: "Profit",
      align: "right",
      sortValue: (b) => b.profit,
      cell: (b) => <span className={`font-medium tabular-nums ${b.profit < 0 ? "text-destructive" : ""}`}>{money.format(b.profit)}</span>,
    },
  ];
  return <DataTable rows={rows} columns={columns} getRowKey={(b, i) => `${b.label}-${i}`} minWidthClassName="min-w-[26rem]" empty="No activity in this period." />;
}
