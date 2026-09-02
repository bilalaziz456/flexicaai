"use client";

import { DataTable, type Column } from "@/core/ui/data-table";
import { Badge } from "@/core/ui/badge";
import { ExpenseRowActions } from "./expense-ui";
import { labelFrom, useVocabulary } from "@/core/ui/vocabulary-provider";

const money = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 });

type Row = {
  id: string;
  incurredOn: string;
  categoryName: string | null;
  recurring: boolean;
  vendor: string | null;
  note: string | null;
  method: string | null;
  amount: number;
  deleted: boolean;
};

/** Expenses ledger table (client) — sortable columns + a mobile card view via DataTable. */
export function ExpensesTable({ rows, canManage, empty }: { rows: Row[]; canManage: boolean; empty: string }) {
  // Labels come from the database (ADR-027). Read once here: a hook cannot run
  // inside a cell callback, so the rows are captured and `labelFrom` used below.
  const methods = useVocabulary("payment_methods");
  const columns: Column<Row>[] = [
    { id: "date", header: "Date", sortValue: (r) => r.incurredOn, cell: (r) => <span className="whitespace-nowrap">{r.incurredOn}</span> },
    {
      id: "category",
      header: "Category",
      cardTitle: true,
      sortValue: (r) => r.categoryName ?? "",
      cell: (r) => (
        <span>
          {r.categoryName ?? "—"}
          {r.recurring ? <Badge variant="outline" className="ml-1.5">Recurring</Badge> : null}
        </span>
      ),
    },
    {
      id: "vendor",
      header: "Vendor",
      sortValue: (r) => r.vendor ?? "",
      cell: (r) => (
        <span>
          {r.vendor ?? "—"}
          {r.note ? <span className="block text-xs text-muted-foreground">{r.note}</span> : null}
        </span>
      ),
    },
    { id: "method", header: "Method", sortValue: (r) => r.method ?? "", cell: (r) => <span>{labelFrom(methods, r.method)}</span> },
    { id: "amount", header: "Amount", align: "right", sortValue: (r) => r.amount, cell: (r) => <span className="font-medium tabular-nums">{money.format(r.amount)}</span> },
    ...(canManage
      ? [{ id: "actions", header: "", align: "right", cell: (r: Row) => <ExpenseRowActions id={r.id} deleted={r.deleted} /> } as Column<Row>]
      : []),
  ];
  return <DataTable rows={rows} columns={columns} getRowKey={(r) => r.id} minWidthClassName="min-w-[44rem]" empty={empty} />;
}
