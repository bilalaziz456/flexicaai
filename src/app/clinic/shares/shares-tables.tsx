"use client";

import Link from "next/link";
import { DataTable, type Column } from "@/core/ui/data-table";
import { VoidPayoutButton } from "./payout-ui";

const money = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 });
const dayFmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

type BalanceRow = { doctorId: string; name: string; earned: number; paid: number; outstanding: number };

/** Per-doctor share balances (client) — sortable + mobile cards. Doctor links to filter. */
export function BalancesTable({ rows }: { rows: BalanceRow[] }) {
  const columns: Column<BalanceRow>[] = [
    {
      id: "doctor",
      header: "Doctor",
      cardTitle: true,
      sortValue: (b) => b.name,
      cell: (b) => (
        <Link href={`/clinic/shares?doctorId=${b.doctorId}`} className="underline underline-offset-4 hover:text-foreground">
          {b.name}
        </Link>
      ),
    },
    { id: "earned", header: "Earned", align: "right", sortValue: (b) => b.earned, cell: (b) => <span className="tabular-nums">{money.format(b.earned)}</span> },
    { id: "paid", header: "Paid", align: "right", sortValue: (b) => b.paid, cell: (b) => <span className="tabular-nums">{money.format(b.paid)}</span> },
    { id: "outstanding", header: "Outstanding", align: "right", sortValue: (b) => b.outstanding, cell: (b) => <span className="font-medium tabular-nums">{money.format(b.outstanding)}</span> },
  ];
  return <DataTable rows={rows} columns={columns} getRowKey={(b) => b.doctorId} minWidthClassName="min-w-[30rem]" initialSort={{ id: "outstanding", dir: "desc" }} empty="No doctor shares yet." />;
}

type PayoutRow = {
  id: string;
  createdAt: Date;
  createdByName: string | null;
  doctorName: string | null;
  method: string | null;
  reference: string | null;
  note: string | null;
  amount: number;
};

/** Doctor payouts (client) — Doctor column shows only in the all-doctors view; the void
 *  action shows only to admins. Sortable + mobile cards. */
export function PayoutsTable({ rows, singleDoctor, isAdmin }: { rows: PayoutRow[]; singleDoctor: boolean; isAdmin: boolean }) {
  const columns: Column<PayoutRow>[] = [
    {
      id: "date",
      header: "Date",
      cardTitle: true,
      sortValue: (p) => p.createdAt.getTime(),
      cell: (p) => (
        <span className="whitespace-nowrap">
          {dayFmt(p.createdAt)}
          {p.createdByName ? <span className="block text-xs text-muted-foreground">by {p.createdByName}</span> : null}
        </span>
      ),
    },
    ...(!singleDoctor
      ? [{ id: "doctor", header: "Doctor", sortValue: (p: PayoutRow) => p.doctorName ?? "", cell: (p: PayoutRow) => p.doctorName ?? "—" } as Column<PayoutRow>]
      : []),
    {
      id: "method",
      header: "Method",
      sortValue: (p) => p.method ?? "",
      cell: (p) => (
        <span className="capitalize">
          {p.method ?? "—"}
          {p.reference ? <span className="block text-xs text-muted-foreground">{p.reference}</span> : null}
          {p.note ? <span className="block text-xs">{p.note}</span> : null}
        </span>
      ),
    },
    { id: "amount", header: "Amount", align: "right", sortValue: (p) => p.amount, cell: (p) => <span className="tabular-nums">{money.format(p.amount)}</span> },
    ...(isAdmin
      ? [{ id: "actions", header: "", align: "right", cell: (p: PayoutRow) => <VoidPayoutButton payoutId={p.id} /> } as Column<PayoutRow>]
      : []),
  ];
  return <DataTable rows={rows} columns={columns} getRowKey={(p) => p.id} minWidthClassName="min-w-[26rem]" initialSort={{ id: "date", dir: "desc" }} empty="No payments recorded yet." />;
}
