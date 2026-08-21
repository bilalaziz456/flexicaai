import { Badge } from "@/core/ui/badge";
import type { QueueSession } from "@/core/appointments/queue";
import { statusLabel, statusVariant } from "@/core/appointments/status";
import { QueueAdvanceButton } from "@/app/clinic/scribe/queue-advance-button";

/**
 * The doctor's actionable queue for today — one card per visiting window, each
 * listing its patients (token, name, live status) with a Call in / Complete button
 * on the in-room states. "In the room" is the token actually in_progress, so late
 * patients who were skipped never show as being served.
 */
export function DoctorQueue({ sessions }: { sessions: QueueSession[] }) {
  if (sessions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No booked patients in your queue today.
      </p>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">Your queue today</h2>
      <div className="grid gap-3 lg:grid-cols-2">
        {sessions.map((s) => (
          <div key={s.key} className="rounded-lg border p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{s.windowLabel}</div>
                <div className="text-xs text-muted-foreground">
                  {s.inRoom} in room · {s.waiting} waiting · {s.notArrived} to arrive · {s.done} done
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xs text-muted-foreground">In the room</div>
                <div className="text-lg font-semibold text-primary-text">
                  {s.nowServing != null ? `#${s.nowServing}` : "—"}
                </div>
              </div>
            </div>

            <ul className="mt-2 divide-y">
              {s.items.map((it) => {
                const missed = it.status === "cancelled" || it.status === "no_show";
                const finished = it.status === "completed";
                return (
                  <li key={it.appointmentId} className="flex items-center gap-2 py-1.5">
                    <span className="w-8 shrink-0 tabular-nums text-muted-foreground">
                      #{it.number}
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
                    <Badge variant={statusVariant(it.status)}>
                      {statusLabel(it.status)}
                    </Badge>
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
