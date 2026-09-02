"use client";

import Link from "next/link";
import { DataTable, type Column } from "@/core/ui/data-table";
import { Badge } from "@/core/ui/badge";
import { labelFrom, useVocabulary } from "@/core/ui/vocabulary-provider";

const money = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 });
const dayFmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const STATUS: Record<string, { label: string; variant: "outline" | "secondary" | "destructive" }> = {
  none: { label: "Applied", variant: "outline" },
  approved: { label: "Approved", variant: "outline" },
  pending: { label: "Pending", variant: "secondary" },
  rejected: { label: "Rejected", variant: "destructive" },
};

type Row = {
  appointmentId: string;
  scheduledAt: Date;
  patientName: string | null;
  doctorName: string | null;
  borneBy: string;
  clinicBears: number;
  doctorBears: number;
  status: string;
  approvedBy: string | null;
  type: string;
  value: number;
  amount: number;
};

const discLabel = (r: Row) =>
  r.type === "percent" ? `${money.format(r.amount)} (${r.value}%)` : money.format(r.amount);

/** Discounts report table (client) — sortable columns + a mobile card view via DataTable. */
export function DiscountsTable({ rows }: { rows: Row[] }) {
  const bearers = useVocabulary("discount_bearers");
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
      id: "borne",
      header: "Borne by",
      sortValue: (r) => r.borneBy,
      cell: (r) => (
        <span>
          {labelFrom(bearers, r.borneBy)}
          {r.borneBy !== "clinic" ? (
            <span className="block text-xs text-muted-foreground">
              Clinic {money.format(r.clinicBears)} · Dr {money.format(r.doctorBears)}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      sortValue: (r) => r.status,
      cell: (r) => (
        <span>
          <Badge variant={STATUS[r.status]?.variant ?? "outline"}>{STATUS[r.status]?.label ?? r.status}</Badge>
          {r.approvedBy ? <span className="block text-xs text-muted-foreground">by {r.approvedBy}</span> : null}
        </span>
      ),
    },
    { id: "discount", header: "Discount", align: "right", sortValue: (r) => r.amount, cell: (r) => <span className="font-medium tabular-nums">{discLabel(r)}</span> },
  ];
  return <DataTable rows={rows} columns={columns} getRowKey={(r) => r.appointmentId} minWidthClassName="min-w-[44rem]" empty="No discounts in this period." />;
}
