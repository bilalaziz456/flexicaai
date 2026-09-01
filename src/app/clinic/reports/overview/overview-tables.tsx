"use client";

import Link from "next/link";
import { DataTable, type Column } from "@/core/ui/data-table";
import { Badge } from "@/core/ui/badge";
import { paymentMethodLabel } from "@/core/finance/payment-methods";

const money = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 });
const dayFmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const BORNE: Record<string, string> = { clinic: "Clinic", doctor: "Doctor", split: "Split" };

type DoctorRow = { doctorId: string | null; name: string; count: number; grossEarned: number; borne: number; net: number };

/** Overview "by doctor" (client) — sortable + mobile cards. */
export function OverviewByDoctorTable({ rows }: { rows: DoctorRow[] }) {
  const columns: Column<DoctorRow>[] = [
    { id: "doctor", header: "Doctor", cardTitle: true, sortValue: (d) => d.name, cell: (d) => d.name },
    { id: "visits", header: "Visits", align: "right", sortValue: (d) => d.count, cell: (d) => <span className="tabular-nums">{d.count}</span> },
    { id: "earned", header: "Earned", align: "right", sortValue: (d) => d.grossEarned, cell: (d) => <span className="tabular-nums">{money.format(d.grossEarned)}</span> },
    { id: "borne", header: "Discount borne", align: "right", sortValue: (d) => d.borne, cell: (d) => <span className={`tabular-nums ${d.borne < 0 ? "text-destructive" : ""}`}>{money.format(d.borne)}</span> },
    { id: "net", header: "Net", align: "right", sortValue: (d) => d.net, cell: (d) => <span className="font-medium tabular-nums">{money.format(d.net)}</span> },
  ];
  return <DataTable rows={rows} columns={columns} getRowKey={(d) => d.doctorId ?? "none"} minWidthClassName="min-w-[30rem]" empty="No doctor shares in this period." />;
}

type CashRow = { method: string; collected: number; refunded: number; expenses: number; payouts: number; net: number };
type CashTotals = { collected: number; refunded: number; expenses: number; payouts: number; net: number };

/** Overview "cash that moved" (client) — sortable + a totals footer + mobile cards. */
export function OverviewCashTable({ rows, totals }: { rows: CashRow[]; totals: CashTotals }) {
  const columns: Column<CashRow>[] = [
    { id: "method", header: "Method", cardTitle: true, sortValue: (r) => r.method, cell: (r) => <span>{paymentMethodLabel(r.method)}</span>, footer: () => "Total" },
    { id: "collected", header: "Collected", align: "right", sortValue: (r) => r.collected, cell: (r) => <span className="tabular-nums">{money.format(r.collected)}</span>, footer: () => <span className="tabular-nums">{money.format(totals.collected)}</span> },
    { id: "refunded", header: "Refunded", align: "right", sortValue: (r) => r.refunded, cell: (r) => <span className="tabular-nums">{money.format(r.refunded)}</span>, footer: () => <span className="tabular-nums">{money.format(totals.refunded)}</span> },
    { id: "expenses", header: "Expenses", align: "right", sortValue: (r) => r.expenses, cell: (r) => <span className="tabular-nums">{money.format(r.expenses)}</span>, footer: () => <span className="tabular-nums">{money.format(totals.expenses)}</span> },
    { id: "payouts", header: "Doctor payouts", align: "right", sortValue: (r) => r.payouts, cell: (r) => <span className="tabular-nums">{money.format(r.payouts)}</span>, footer: () => <span className="tabular-nums">{money.format(totals.payouts)}</span> },
    { id: "net", header: "Net", align: "right", sortValue: (r) => r.net, cell: (r) => <span className="font-medium tabular-nums">{money.format(r.net)}</span>, footer: () => <span className="tabular-nums">{money.format(totals.net)}</span> },
  ];
  return <DataTable rows={rows} columns={columns} getRowKey={(r) => r.method} minWidthClassName="min-w-[32rem]" empty="No cash movement in this period." />;
}

type DiscountRow = { appointmentId: string; scheduledAt: Date; patientName: string | null; doctorName: string | null; borneBy: string; status: string; amount: number };

/** Overview "discounts & waivers" (client) — sortable + mobile cards. */
export function OverviewDiscountsTable({ rows }: { rows: DiscountRow[] }) {
  const columns: Column<DiscountRow>[] = [
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
          {BORNE[r.borneBy] ?? "Clinic"}
          {r.status === "pending" ? <Badge variant="secondary" className="ml-1.5">Pending</Badge> : null}
        </span>
      ),
    },
    { id: "discount", header: "Discount", align: "right", sortValue: (r) => r.amount, cell: (r) => <span className="font-medium tabular-nums">{money.format(r.amount)}</span> },
  ];
  return <DataTable rows={rows} columns={columns} getRowKey={(r) => r.appointmentId} minWidthClassName="min-w-[30rem]" empty="No discounts in this period." />;
}
