import { CalendarCheck, FileCheck, NotebookPen } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/core/ui/badge";
import { Card, CardContent } from "@/core/ui/card";
import { EmptyState } from "@/core/ui/empty-state";
import type { QueueSession } from "@/core/appointments/queue";
import { statusVariant } from "@/core/appointments/status";
import { QueueAdvanceButton } from "@/app/clinic/scribe/queue-advance-button";
import { vocabularyLabel } from "@/core/db/vocabulary-cache";

const timeFmt = (d: Date) =>
  d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/**
 * The doctor's actionable queue for today — one card per visiting window, each
 * listing its patients (token, slot time, name, live status) with a Call in /
 * Complete button on the in-room states. "In the room" is the token actually in_progress, so late
 * patients who were skipped never show as being served.
 */
export function DoctorQueue({ sessions, canWrite = false }: { sessions: QueueSession[]; canWrite?: boolean }) {
  if (sessions.length === 0) {
    // It used to be a bare line of muted text between the page header and the first
    // card — the only thing on the page not sitting on a surface, which read as a
    // stray sentence rather than as this section's answer.
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState
            compact
            icon={CalendarCheck}
            title="Nothing booked today"
            description="Patients booked with you appear here in the order they arrive. You can still record a visit for anyone below."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Your queue today</h2>
      <div className="grid gap-2 lg:grid-cols-2">
        {sessions.map((s) => (
          <div key={s.key} className="rounded-lg border well px-3 py-2">
            {/* One line for the window: hours, counts, who is in the room — kept short
                so the queue never pushes the note workspace off the screen (owner, 2026-11-14). */}
            <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 truncate">
                <span className="font-medium text-foreground">{s.windowLabel}</span>
                {" · "}
                {s.inRoom} in room · {s.waiting} waiting · {s.notArrived} to arrive · {s.done} done
              </span>
              <span className="shrink-0">
                In room{" "}
                <span className="font-semibold text-primary-text">
                  {s.nowServing != null ? `#${s.nowServing}` : "—"}
                </span>
              </span>
            </div>

            <ul className="mt-1 divide-y">
              {s.items.map((it) => {
                const missed = it.status === "cancelled" || it.status === "no_show";
                const finished = it.status === "completed";
                // A row opens its note: one already written opens the patient's clinical
                // history; one not written yet opens the note screen for THIS appointment
                // (record or type), as the Clinical notes list does. A missed visit has
                // no note to write.
                const href = it.hasNote
                  ? `/clinic/patients/${it.patientId}#clinical-history`
                  : canWrite && !missed
                    ? `/clinic/scribe?appointment=${it.appointmentId}#note-workspace`
                    : null;
                const body = (
                  <>
                    <span className="w-7 shrink-0 tabular-nums text-muted-foreground">#{it.number}</span>
                    {/* The slot time, next to the token. The queue runs first-come,
                        so the order is by token — but a visit can be booked at a
                        CUSTOM time outside the doctor's usual hours, and without the
                        time on the row there is nothing to show that the 6pm
                        procedure is not simply next. */}
                    <span className="w-11 shrink-0 tabular-nums text-xs text-muted-foreground">
                      {timeFmt(it.scheduledAt)}
                    </span>
                    <span
                      className={
                        "min-w-0 flex-1 truncate text-sm " +
                        (missed
                          ? "text-muted-foreground line-through"
                          : finished
                            ? "text-muted-foreground"
                            : "font-medium")
                      }
                    >
                      {it.patientName}
                    </span>
                    {it.hasNote ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        <FileCheck className="size-3.5" aria-hidden /> Note
                      </span>
                    ) : href ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-primary-text opacity-70 group-hover:opacity-100">
                        <NotebookPen className="size-3.5" aria-hidden /> Add note
                      </span>
                    ) : null}
                    <Badge variant={statusVariant(it.status)} className="h-5 px-1.5 text-[0.7rem]">
                      {vocabularyLabel("appointment_statuses", it.status)}
                    </Badge>
                  </>
                );
                return (
                  <li key={it.appointmentId} className="flex items-center gap-2 py-0.5">
                    {href ? (
                      <Link
                        href={href}
                        className="group -mx-1 flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        {body}
                      </Link>
                    ) : (
                      <div className="flex min-w-0 flex-1 items-center gap-2 py-1">{body}</div>
                    )}
                    <QueueAdvanceButton appointmentId={it.appointmentId} status={it.status} />
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
