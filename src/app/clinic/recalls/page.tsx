import { listClinicRecalls } from "@/core/recall/list";
import { requireWorkspace } from "@/core/auth/user";
import { Badge } from "@/core/ui/badge";
import { pageOffset, parsePage, parsePageSize } from "@/core/lib/pagination";
import { Pagination } from "@/core/ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/core/ui/table";

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive"
> = {
  booked: "default",
  sent: "secondary",
  pending: "secondary",
  cancelled: "destructive",
};

/** Clinic Admin: upcoming & sent recalls. The engine (cron) sends reminders. */
export default async function ClinicRecallsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; size?: string }>;
}) {
  const { clinicId } = await requireWorkspace("recalls");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.size);

  const { rows, total } = await listClinicRecalls(clinicId, {
    offset: pageOffset(page, pageSize),
    limit: pageSize,
  });

  const fmt = (d: Date) =>
    d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Recalls</h1>
        <p className="text-sm text-muted-foreground">
          {total} recall{total === 1 ? "" : "s"}. Reminders go out automatically
          over WhatsApp when they&apos;re due.
        </p>
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath="/clinic/recalls"
        searchParams={sp}
        unit="recall"
      />

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          No recalls yet. They&apos;re created when a doctor approves a visit with
          a next-visit date.
        </div>
      ) : (
        <>
          {/* Desktop: full table. */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.patientName}</TableCell>
                    <TableCell>{r.reason ?? "—"}</TableCell>
                    <TableCell>{fmt(r.dueAt)}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[r.status] ?? "secondary"}>
                        {r.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: stacked cards — no horizontal scroll. */}
          <ul className="space-y-3 md:hidden">
            {rows.map((r) => (
              <li key={r.id} className="space-y-1 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{r.patientName}</span>
                  <Badge variant={STATUS_VARIANT[r.status] ?? "secondary"}>
                    {r.status}
                  </Badge>
                </div>
                <div className="text-sm text-muted-foreground">
                  {r.reason ?? "Follow-up"} · due {fmt(r.dueAt)}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
