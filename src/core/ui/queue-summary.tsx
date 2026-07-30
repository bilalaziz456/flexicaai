import Link from "next/link";
import type { QueueSession } from "@/core/appointments/queue";
import { statusLabel } from "@/core/appointments/status";
import { cn } from "@/core/lib/utils";

/**
 * Live patient-queue summary (server component) for a day — one card per doctor
 * visiting-window session. Shows who's up next ("Now serving #X"), how many are
 * waiting/done, and a strip of token chips coloured by status. Presentational;
 * the caller supplies sessions from `getDayQueue`.
 *
 * When `pathname` is set the cards become clickable filters: clicking a card
 * links to `?session=<key>` (the list then shows only that queue); the
 * `activeSession` card is highlighted, and clicking it again clears back to the
 * full list.
 */
export function QueueSummary({
  sessions,
  title = "Today's queue",
  emptyHint,
  pathname,
  activeSession,
}: {
  sessions: QueueSession[];
  title?: string;
  emptyHint?: string;
  pathname?: string;
  activeSession?: string;
}) {
  const clickable = Boolean(pathname);
  const hrefFor = (key: string) =>
    activeSession === key ? pathname! : `${pathname}?session=${encodeURIComponent(key)}`;
  if (sessions.length === 0) {
    return emptyHint ? (
      <p className="text-sm text-muted-foreground">{emptyHint}</p>
    ) : null;
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {sessions.map((s) => {
          const active = activeSession === s.key;
          const cardCls = cn(
            "block rounded-lg border p-3 text-left",
            active && "border-primary ring-1 ring-primary/40",
            clickable && "cursor-pointer transition-colors hover:border-primary/60",
          );
          const inner = (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{s.doctorName}</div>
                  <div className="text-xs text-muted-foreground">{s.windowLabel}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-xs text-muted-foreground">In the room</div>
                  <div className="text-lg font-semibold text-primary">
                    {s.nowServing != null ? `#${s.nowServing}` : "—"}
                  </div>
                </div>
              </div>

              <div className="mt-1.5 text-xs text-muted-foreground">
                {s.inRoom} in room · {s.waiting} waiting · {s.notArrived} to arrive · {s.done} done
              </div>

              <ul className="mt-2 flex flex-wrap gap-1">
                {s.items.map((it) => {
                  const inRoom = it.status === "in_progress";
                  const waiting = it.status === "arrived";
                  const done = it.status === "completed";
                  const missed = it.status === "cancelled" || it.status === "no_show";
                  const notArrived = it.status === "scheduled" || it.status === "confirmed";
                  // A booked patient whose slot time has passed but who hasn't checked in.
                  const late = notArrived && it.scheduledAt.getTime() < Date.now();
                  return (
                    <li
                      key={it.appointmentId}
                      title={`${it.patientName} · ${statusLabel(it.status)}`}
                      className={cn(
                        "inline-flex min-w-6 items-center justify-center rounded-md border px-1.5 py-0.5 text-xs",
                        inRoom && "border-primary bg-primary font-semibold text-primary-foreground",
                        waiting && "border-primary text-primary",
                        done && "border-transparent bg-accent text-accent-foreground",
                        missed && "border-transparent text-muted-foreground line-through",
                        notArrived && !late && "border-input",
                        notArrived && late && "border-amber-500 text-warning",
                      )}
                    >
                      #{it.number}
                    </li>
                  );
                })}
              </ul>
            </>
          );

          return clickable ? (
            <Link
              key={s.key}
              href={hrefFor(s.key)}
              scroll={false}
              aria-pressed={active}
              className={cardCls}
            >
              {inner}
            </Link>
          ) : (
            <div key={s.key} className={cardCls}>
              {inner}
            </div>
          );
        })}
      </div>
    </section>
  );
}
