import { CalendarDays, Mic, PenLine } from "lucide-react";
import { TableCard } from "@/core/ui/table-card";
import { EmptyState } from "@/core/ui/empty-state";
import { Badge } from "@/core/ui/badge";
import { RowLink } from "@/core/ui/row-link";
import { Pagination } from "@/core/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/core/ui/table";
import { displayStaffName } from "@/core/types/auth";
import type { NotesAppointmentRow, NoteSummary } from "@/core/clinical/notes-appointments";
import { NotesFilters } from "@/app/clinic/scribe/notes-filters";

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  confirmed: "Confirmed",
  arrived: "Arrived",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
};

/** Appointments a note can be started from: not cancelled, not a no-show. */
const NOTE_CLOSED = new Set(["cancelled", "no_show"]);

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true });

/**
 * The appointments of a period, each with its clinical note — or the lack of one
 * (owner, 2026-11-14). A row opens the note screen for that appointment, where whoever
 * may record or type starts its note; one that already has a note opens the patient.
 */
export function NotesAppointments({
  rows,
  total,
  completedWithoutNote,
  page,
  pageSize,
  searchParams,
  filters,
  canWrite,
}: {
  rows: NotesAppointmentRow[];
  total: number;
  completedWithoutNote: number;
  page: number;
  pageSize: number;
  searchParams: Record<string, string | undefined>;
  filters: React.ComponentProps<typeof NotesFilters>;
  /** May record or type a note: a row without one opens the note screen. */
  canWrite: boolean;
}) {
  return (
    <TableCard
      title={
        <span className="flex flex-wrap items-baseline gap-x-3">
          Appointments
          {completedWithoutNote > 0 ? (
            <span className="text-sm font-normal text-warning-text">
              {completedWithoutNote} completed without a note
            </span>
          ) : null}
        </span>
      }
    >
      <div className="space-y-3">
        <NotesFilters {...filters} />
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          basePath="/clinic/scribe"
          searchParams={searchParams}
          unit="appointment"
          pageParam="apage"
          sizeParam="asize"
        />
        {rows.length === 0 ? (
          <EmptyState
            compact
            icon={CalendarDays}
            title="No appointments"
            description="Appointments in this period appear here, each with its clinical note or a way to write one."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Doctor</TableHead>
                <TableHead>Appointment</TableHead>
                <TableHead>Clinical note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const opensNote = canWrite && !r.note && !NOTE_CLOSED.has(String(r.status));
                const href = opensNote
                  ? `/clinic/scribe?appointment=${r.id}`
                  : `/clinic/patients/${r.patientId}#clinical-history`;
                return (
                  <RowLink key={r.id} href={href} className="border-b">
                    <TableCell className="tabular-nums text-muted-foreground">{r.queueNumber ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {dateFmt.format(r.scheduledAt)}
                      <span className="block text-xs text-muted-foreground">{timeFmt.format(r.scheduledAt)}</span>
                    </TableCell>
                    <TableCell className="font-medium">
                      {r.patientName}
                      {r.mrn ? <span className="block text-xs font-normal text-muted-foreground">{r.mrn}</span> : null}
                    </TableCell>
                    <TableCell>
                      {r.doctorId ? displayStaffName(r.doctorPrefix, r.doctorName, r.doctorUsername ?? "") : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>{STATUS_LABEL[String(r.status)] ?? String(r.status)}</TableCell>
                    <TableCell>
                      <NoteCell note={r.note} appointmentStatus={String(r.status)} opensNote={opensNote} />
                    </TableCell>
                  </RowLink>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </TableCard>
  );
}

function NoteCell({
  note,
  appointmentStatus,
  opensNote,
}: {
  note: NoteSummary | null;
  appointmentStatus: string;
  opensNote: boolean;
}) {
  if (!note) {
    if (NOTE_CLOSED.has(appointmentStatus)) return <span className="text-muted-foreground">—</span>;
    return (
      <span className="flex flex-wrap items-center gap-2">
        <Badge variant={appointmentStatus === "completed" ? "destructive" : "outline"}>No note yet</Badge>
        {opensNote ? <span className="text-xs text-primary">Write note →</span> : null}
      </span>
    );
  }
  const author = displayStaffName(note.authorPrefix, note.authorName, note.authorUsername ?? "");
  const approver = displayStaffName(note.approverPrefix, note.approverName, note.approverUsername ?? "");
  const treating = displayStaffName(note.treatingPrefix, note.treatingName, note.treatingUsername ?? "");
  const How = note.voice ? Mic : PenLine;
  const status = String(note.status);
  return (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-1.5">
        {status === "approved" ? (
          <Badge>Note written</Badge>
        ) : status === "pending_approval" ? (
          <Badge variant="secondary">Waiting for {treating || "the doctor"}</Badge>
        ) : status === "returned" ? (
          <Badge variant="secondary">Sent back to the writer</Badge>
        ) : (
          <Badge variant="secondary">Draft, not approved</Badge>
        )}
      </span>
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <How className="size-3" aria-hidden="true" />
        <span>
          {note.voice ? "Recorded" : "Typed"} by {author || "someone no longer here"}
          {status === "approved" && approver && approver !== author ? ` · approved by ${approver}` : ""}
        </span>
      </span>
    </span>
  );
}
