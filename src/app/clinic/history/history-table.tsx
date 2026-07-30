"use client";

import Link from "next/link";
import { DataTable, type Column } from "@/core/ui/data-table";
import type { HistoryType, ImportedHistoryRow } from "@/core/finance/imported-history";

const money = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 });
const TYPE_BADGE: Record<string, string> = {
  invoice: "Invoice",
  payment: "Payment",
  refund: "Refund",
  expense: "Expense",
  doctor_payout: "Payout",
};
const dayFmt = (d: string | null) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/**
 * The imported-history ledger table (client) — column config for the shared `DataTable`,
 * shaped by the active tab. Sortable columns + a mobile card view come from DataTable.
 */
export function HistoryTable({ rows, tab }: { rows: ImportedHistoryRow[]; tab: HistoryType }) {
  const columns: Column<ImportedHistoryRow>[] = [
    {
      id: "date",
      header: "Date",
      cardTitle: true,
      sortValue: (r) => r.txnDate ?? "",
      cell: (r) => <span className="whitespace-nowrap">{dayFmt(r.txnDate)}</span>,
    },
    {
      id: "ref",
      header: "Ref",
      sortValue: (r) => r.reference ?? "",
      cell: (r) => <span className="tabular-nums text-muted-foreground">{r.reference ?? "—"}</span>,
    },
    tab === "doctor_payout"
      ? { id: "who", header: "Doctor", sortValue: (r) => r.doctorName ?? "", cell: (r) => r.doctorName ?? "—" }
      : tab === "expense"
        ? { id: "who", header: "Details", sortValue: (r) => r.description ?? "", cell: (r) => r.description ?? "—" }
        : {
            id: "who",
            header: "Patient",
            sortValue: (r) => r.patientName ?? "",
            cell: (r) =>
              r.patientId ? (
                <Link href={`/clinic/patients/${r.patientId}`} className="underline underline-offset-4">
                  {r.patientName ?? "—"}
                </Link>
              ) : (
                (r.patientName ?? "—")
              ),
          },
    ...(tab !== "expense"
      ? [
          {
            id: "details",
            header: "Details",
            cell: (r) => <span className="text-muted-foreground">{r.description ?? "—"}</span>,
          } as Column<ImportedHistoryRow>,
        ]
      : []),
    ...(tab === "payment"
      ? [
          { id: "method", header: "Method", sortValue: (r) => r.method ?? "", cell: (r) => r.method ?? "—" } as Column<ImportedHistoryRow>,
          { id: "type", header: "Type", sortValue: (r) => r.type, cell: (r) => TYPE_BADGE[r.type] ?? r.type } as Column<ImportedHistoryRow>,
        ]
      : []),
    {
      id: "amount",
      header: "Amount",
      align: "right",
      sortValue: (r) => (r.type === "refund" ? -r.amount : r.amount),
      cell: (r) => (
        <span className="font-medium tabular-nums">
          {r.type === "refund" ? "−" : ""}
          {money.format(r.amount)}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      getRowKey={(r) => r.id}
      minWidthClassName="min-w-[40rem]"
      empty="Nothing matches these filters."
    />
  );
}
