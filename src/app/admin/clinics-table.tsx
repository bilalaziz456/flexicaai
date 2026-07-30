"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { DataTable, type Column } from "@/core/ui/data-table";
import { Badge } from "@/core/ui/badge";
import { buttonVariants } from "@/core/ui/button";
import { billingCycleLabel } from "@/core/clinics/status";
import { ClinicStatusBadge } from "./clinics/status-badge";
import { cn } from "@/core/lib/utils";

const fmtDate = (d: Date | null) =>
  d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const t = (d: Date | null) => (d ? d.getTime() : 0);

export type ClinicRow = {
  id: string;
  name: string;
  status: string;
  isYou: boolean;
  assigneeName: string | null;
  assigneeSuspended: boolean;
  specialties: string[];
  trialStartAt: Date | null;
  activatedAt: Date | null;
  billingCycle: string;
  firstPaymentAt: Date | null;
  createdAt: Date;
};

/**
 * Super-admin clinics list (client) — the shared DataTable with sortable columns, a
 * whole-row link to the clinic, and a mobile card view. Billing columns (Package,
 * First payment) render only for billing viewers.
 */
export function ClinicsTable({ rows, showBilling, empty }: { rows: ClinicRow[]; showBilling: boolean; empty: string }) {
  const columns: Column<ClinicRow>[] = [
    { id: "name", header: "Clinic", cardTitle: true, sortValue: (r) => r.name.toLowerCase(), cell: (r) => <span className="font-medium">{r.name}</span> },
    { id: "status", header: "Status", sortValue: (r) => r.status, cell: (r) => <ClinicStatusBadge status={r.status} /> },
    ...(showBilling
      ? [{ id: "package", header: "Package", sortValue: (r: ClinicRow) => r.billingCycle, cell: (r: ClinicRow) => <span className="whitespace-nowrap text-sm">{billingCycleLabel(r.billingCycle)}</span> } as Column<ClinicRow>]
      : []),
    { id: "trial", header: "Trial start", sortValue: (r) => t(r.trialStartAt), cell: (r) => <span className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(r.trialStartAt)}</span> },
    { id: "active", header: "Active start", sortValue: (r) => t(r.activatedAt), cell: (r) => <span className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(r.activatedAt)}</span> },
    ...(showBilling
      ? [{ id: "firstpay", header: "First payment", sortValue: (r: ClinicRow) => t(r.firstPaymentAt), cell: (r: ClinicRow) => <span className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(r.firstPaymentAt)}</span> } as Column<ClinicRow>]
      : []),
    {
      id: "assigned",
      header: "Assigned to",
      sortValue: (r) => (r.isYou ? "" : r.assigneeName ?? "~"),
      cell: (r) =>
        r.isYou ? (
          <span className="text-sm font-medium">You</span>
        ) : r.assigneeName ? (
          <span className="text-sm">
            {r.assigneeName}
            {r.assigneeSuspended ? <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">(suspended)</span> : null}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    {
      id: "specialties",
      header: "Specialties",
      hideOnCard: true,
      cell: (r) =>
        r.specialties.length === 0 ? (
          <span className="text-muted-foreground">None</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {r.specialties.map((s) => (
              <Badge key={s} variant="secondary">
                {s}
              </Badge>
            ))}
          </div>
        ),
    },
    { id: "created", header: "Created", sortValue: (r) => r.createdAt.getTime(), cell: (r) => <span className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(r.createdAt)}</span> },
    {
      id: "manage",
      header: "",
      align: "right",
      hideOnCard: true,
      cell: (r) => (
        <Link href={`/admin/clinics/${r.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Open
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      ),
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      getRowKey={(r) => r.id}
      rowHref={(r) => `/admin/clinics/${r.id}`}
      minWidthClassName="min-w-[68rem]"
      initialSort={{ id: "created", dir: "desc" }}
      empty={empty}
    />
  );
}
