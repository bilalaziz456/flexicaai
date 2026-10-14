"use client";

import Link from "next/link";
import { HandCoins, Printer } from "lucide-react";
import { DataTable, type Column } from "@/core/ui/data-table";
import { labelFrom, useVocabulary } from "@/core/ui/vocabulary-provider";
import { DownloadLink } from "@/core/ui/download-link";

const money = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 });
const dayFmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
// Mirrors payments-ledger.ts#isMoneyOut (that module is server-only — can't import here).
const isMoneyOut = (kind: string) => kind === "refund";

type Row = {
  id: string;
  invoiceLabel: string | null;
  invoiceVoided: boolean;
  occurredAt: Date;
  patientId: string;
  patientName: string;
  doctorName: string | null;
  kind: string;
  method: string | null;
  /** Free text from the form — for a refund, its reason. */
  note: string | null;
  createdByName: string | null;
  amount: number;
  appointmentId: string | null;
};

/** Payments ledger table (client) — sortable columns + a mobile card view via DataTable. */
export function PaymentsTable({ rows, empty }: { rows: Row[]; empty: string }) {
  // Labels come from the database (ADR-027); read once, since a hook cannot run
  // inside a cell or map callback.
  const kindLabels = useVocabulary("payment_kinds");
  // Labels come from the database (ADR-027). Read once here: a hook cannot run
  // inside a cell callback, so the rows are captured and `labelFrom` used below.
  const methods = useVocabulary("payment_methods");
  const columns: Column<Row>[] = [
    {
      id: "invoice",
      header: "Invoice #",
      sortValue: (r) => r.invoiceLabel ?? "",
      // Every payment is shown against its visit's invoice. Opens the visit, where the
      // invoice, its payments and what is still owed sit together.
      cell: (r) =>
        r.invoiceLabel && r.appointmentId ? (
          <Link
            href={`/clinic/appointments/${r.appointmentId}`}
            className={`whitespace-nowrap tabular-nums underline underline-offset-4 ${r.invoiceVoided ? "text-muted-foreground line-through" : ""}`}
            title={r.invoiceVoided ? "Void — the visit was cancelled or became a no-show" : undefined}
          >
            {r.invoiceLabel}
          </Link>
        ) : (
          <span className="text-muted-foreground" title={r.appointmentId ? "No invoice yet" : "Advance — not yet against a visit"}>—</span>
        ),
    },
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
    {
      id: "type",
      header: "Type",
      sortValue: (r) => r.kind,
      // The note rides under the type rather than taking a column: it is what explains
      // a refund ("overcharged", "procedure not done"), and the table is wide already.
      cell: (r) => (
        <div className="max-w-56">
          {labelFrom(kindLabels, r.kind)}
          {r.note ? (
            <span className="block truncate text-xs text-muted-foreground" title={r.note}>
              {r.note}
            </span>
          ) : null}
        </div>
      ),
    },
    { id: "method", header: "Method", sortValue: (r) => r.method ?? "", cell: (r) => labelFrom(methods, r.method) },
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
      id: "print",
      header: "Print",
      align: "right",
      // The patient's paper is the invoice (it lists every payment), so Print opens it.
      cell: (r) =>
        r.appointmentId && r.invoiceLabel ? (
          <div className="flex items-center justify-end gap-3">
            <Link
              href={`/clinic/invoices/${r.appointmentId}/print`}
              className="inline-flex min-h-6 items-center gap-1 text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              <Printer className="size-3.5" aria-hidden="true" /> Print
            </Link>
            <DownloadLink href={`/clinic/invoices/${r.appointmentId}/print`} className="min-h-6 gap-1 font-normal text-muted-foreground underline hover:text-foreground" />
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];
  return <DataTable rows={rows} columns={columns} getRowKey={(r) => r.id} minWidthClassName="min-w-[60rem]" emptyIcon={HandCoins} empty={empty} />;
}
