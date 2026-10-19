"use client";

import { useTransition } from "react";
import { Check, Pill, Plus } from "lucide-react";
import { DataTable, type Column } from "@/core/ui/data-table";
import { EmptyState } from "@/core/ui/empty-state";
import { Button } from "@/core/ui/button";
import { toast } from "@/core/ui/toast";
import { addClinicMedicineToMaster } from "./actions";

type Row = {
  id: string;
  name: string;
  brands: string[];
  form: string | null;
  strength: string | null;
  clinicName: string;
  createdByName: string | null;
  createdAt: Date;
  inMaster: boolean;
};

const dayFmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/**
 * Medicines clinics added to their own lists — read-only, so the super admin can
 * see what the master list is missing and copy a useful one in. Copying leaves the
 * clinic's own entry as it is.
 */
export function ClinicAddedTable({ rows, canAdd }: { rows: Row[]; canAdd: boolean }) {
  const [pending, start] = useTransition();
  const add = (r: Row) =>
    start(async () => {
      const res = await addClinicMedicineToMaster(r.id);
      if (res.error) toast.error(res.error);
      else toast.success(`${r.name} added to the medicine list.`);
    });

  const columns: Column<Row>[] = [
    {
      id: "name",
      header: "Medicine",
      cardTitle: true,
      sortValue: (r) => r.name.toLowerCase(),
      cell: (r) => (
        <div className="min-w-0">
          <span className="font-medium">{r.name}</span>
          {r.brands.length ? <span className="block text-xs text-muted-foreground">{r.brands.join(", ")}</span> : null}
        </div>
      ),
    },
    {
      id: "form",
      header: "Form & strength",
      cell: (r) => [r.form, r.strength].filter(Boolean).join(" · ") || <span className="text-muted-foreground">—</span>,
    },
    { id: "clinic", header: "Clinic", sortValue: (r) => r.clinicName, cell: (r) => r.clinicName },
    {
      id: "added",
      header: "Added",
      sortValue: (r) => new Date(r.createdAt).getTime(),
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {dayFmt(new Date(r.createdAt))}
          {r.createdByName ? ` · ${r.createdByName}` : ""}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (r) =>
        r.inMaster ? (
          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
            <Check className="size-3.5" aria-hidden="true" /> On the list
          </span>
        ) : canAdd ? (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => add(r)}>
            <Plus className="size-3.5" aria-hidden="true" /> Add to list
          </Button>
        ) : null,
    },
  ];

  return rows.length ? (
    <DataTable rows={rows} columns={columns} getRowKey={(r) => r.id} empty="Nothing added yet" />
  ) : (
    <EmptyState
      icon={Pill}
      title="No clinic has added a medicine"
      description="When a clinic adds a medicine to its own list, it shows here."
    />
  );
}
