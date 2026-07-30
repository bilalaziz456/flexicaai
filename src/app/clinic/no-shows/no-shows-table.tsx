"use client";

import { DataTable, type Column } from "@/core/ui/data-table";

const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

type Row = { doctorId: string | null; name: string; noShow: number; attended: number; rate: number };

/** No-show rate per doctor (client) — sortable + mobile cards via DataTable. */
export function NoShowsTable({ rows }: { rows: Row[] }) {
  const columns: Column<Row>[] = [
    { id: "doctor", header: "Doctor", cardTitle: true, sortValue: (r) => r.name, cell: (r) => r.name },
    { id: "noshow", header: "No-shows", align: "right", sortValue: (r) => r.noShow, cell: (r) => <span className="tabular-nums">{r.noShow}</span> },
    { id: "attended", header: "Attended", align: "right", sortValue: (r) => r.attended, cell: (r) => <span className="tabular-nums">{r.attended}</span> },
    { id: "rate", header: "Rate", align: "right", sortValue: (r) => r.rate, cell: (r) => <span className="font-medium tabular-nums">{pct(r.rate)}</span> },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      getRowKey={(r) => r.doctorId ?? "none"}
      minWidthClassName="min-w-[26rem]"
      initialSort={{ id: "rate", dir: "desc" }}
      empty="No completed or missed appointments in this period."
    />
  );
}
