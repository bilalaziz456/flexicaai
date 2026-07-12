import { Badge } from "@/core/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/core/ui/table";

export type ActivityLogRow = {
  id: string;
  createdAt: Date;
  actorName: string;
  actorRole: string | null;
  action: string;
  summary: string;
  clinicName?: string | null;
};

const ACTION_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  create: "default",
  update: "secondary",
  status: "secondary",
  view: "outline",
  login: "outline",
  delete: "destructive",
};

const fmt = (d: Date) =>
  d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const who = (r: ActivityLogRow) =>
  r.actorRole ? `${r.actorName} · ${r.actorRole.replace("_", " ")}` : r.actorName;

/**
 * Activity-log list (server component) — a responsive table of audit rows.
 * `showClinic` adds a Clinic column (super-admin, cross-clinic view).
 */
export function ActivityLogList({
  rows,
  showClinic = false,
  emptyHint = "No activity yet.",
}: {
  rows: ActivityLogRow[];
  showClinic?: boolean;
  emptyHint?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
        {emptyHint}
      </div>
    );
  }

  return (
    <>
      {/* Desktop table. */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Details</TableHead>
              {showClinic ? <TableHead>Clinic</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {fmt(r.createdAt)}
                </TableCell>
                <TableCell className="whitespace-nowrap">{who(r)}</TableCell>
                <TableCell>
                  <Badge variant={ACTION_VARIANT[r.action] ?? "secondary"}>
                    {r.action}
                  </Badge>
                </TableCell>
                <TableCell>{r.summary}</TableCell>
                {showClinic ? (
                  <TableCell className="text-muted-foreground">
                    {r.clinicName ?? "—"}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile cards. */}
      <ul className="space-y-3 md:hidden">
        {rows.map((r) => (
          <li key={r.id} className="space-y-1 rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <Badge variant={ACTION_VARIANT[r.action] ?? "secondary"}>
                {r.action}
              </Badge>
              <span className="text-xs text-muted-foreground">{fmt(r.createdAt)}</span>
            </div>
            <div className="text-sm">{r.summary}</div>
            <div className="text-xs text-muted-foreground">
              {who(r)}
              {showClinic && r.clinicName ? ` · ${r.clinicName}` : ""}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
