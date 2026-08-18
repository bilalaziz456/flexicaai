import Link from "next/link";
import { ChevronLeft, ChevronRight, MessageCircle } from "lucide-react";
import type { CalendarDay } from "@/core/appointments/calendar";
import { WEEKDAYS } from "@/core/lib/availability";
import { cn } from "@/core/lib/utils";

/** Leading blanks so the 1st lands under its weekday (the grid is Mon-first). */
function leadingBlanks(firstDate: string): number {
  const weekday = new Date(`${firstDate}T00:00:00`).getDay();
  return WEEKDAYS.findIndex((w) => w.value === weekday);
}

const longDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

/**
 * The month grid above the appointments table. Each cell carries the day's load;
 * hovering (or tab-focusing) a cell opens a card with the visit-type breakdown
 * and which doctors are visiting, with their hours — the answer a receptionist
 * needs while a patient is on the phone. Clicking a day filters the table below
 * to that date; every other filter is left exactly as the user set it.
 *
 * Pure CSS hover/focus, so this stays a server component: no client JS, no
 * hydration cost on a page that already ships a filter bar.
 */
export function AppointmentMonth({
  days,
  today,
  monthLabel,
  prevHref,
  nextHref,
  todayHref,
  dayHref,
  selectedFrom,
  selectedTo,
}: {
  days: CalendarDay[];
  /** Local "YYYY-MM-DD" — outlined in the grid. */
  today: string;
  monthLabel: string;
  prevHref: string;
  nextHref: string;
  todayHref: string;
  /** Builds the "filter the table to this date" link. */
  dayHref: (date: string) => string;
  /** The table's current range, highlighted in the grid. */
  selectedFrom: string;
  selectedTo: string;
}) {
  if (days.length === 0) return null;
  // Bars are relative to the busiest day, so a quiet month still reads as a
  // shape rather than 30 near-identical stubs.
  const busiest = Math.max(...days.map((d) => d.total), 1);
  const blanks = leadingBlanks(days[0].date);
  const rows = Math.ceil((blanks + days.length) / 7);
  const navCls =
    "inline-flex size-8 items-center justify-center rounded-lg border border-input text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50";

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-1">
        <Link href={prevHref} scroll={false} aria-label="Previous month" className={navCls}>
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Link>
        <h2 className="min-w-40 text-center text-sm font-semibold">{monthLabel}</h2>
        <Link href={nextHref} scroll={false} aria-label="Next month" className={navCls}>
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
        <Link
          href={todayHref}
          scroll={false}
          className="ml-1 inline-flex h-8 items-center rounded-lg border border-input px-2.5 text-sm text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Today
        </Link>
      </div>

      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {WEEKDAYS.map((w) => (
          <div key={w.value} className="px-1 pb-0.5 text-xs font-medium text-muted-foreground">
            {w.short}
          </div>
        ))}

        {Array.from({ length: blanks }, (_, i) => (
          <div key={`blank-${i}`} aria-hidden="true" />
        ))}

        {days.map((d, i) => {
          const isToday = d.date === today;
          const selected = d.date >= selectedFrom && d.date <= selectedTo;
          const visiting = d.doctors.filter((x) => !x.onLeave);
          // Anchor the card so it stays on screen: right-aligned in the last
          // columns, and opening upward on the bottom rows (otherwise it hangs
          // below the fold and you'd have to scroll to read it). Derived from the
          // grid position, not the DOM index — the grid also holds the weekday
          // headers and the leading blanks.
          const cell = blanks + i;
          const column = cell % 7;
          const bottomRow = Math.floor(cell / 7) >= rows - 2;
          return (
            <div key={d.date} className="group relative">
              <Link
                href={dayHref(d.date)}
                scroll={false}
                className={cn(
                  "flex min-h-20 flex-col rounded-lg border p-1.5 outline-none transition-colors sm:min-h-24 sm:p-2",
                  "hover:border-primary/60 focus-visible:ring-3 focus-visible:ring-ring/50",
                  isToday && "border-primary",
                  selected && "bg-accent ring-1 ring-primary/40",
                )}
              >
                <div className="flex items-start justify-between gap-1">
                  <span
                    className={cn(
                      "text-sm tabular-nums",
                      isToday ? "font-semibold text-primary-text" : "text-muted-foreground",
                    )}
                  >
                    {Number(d.date.slice(8))}
                  </span>
                  {d.pendingWhatsapp > 0 ? (
                    <span className="inline-flex items-center gap-0.5 rounded-md bg-warning/10 px-1 text-[0.65rem] font-medium text-warning-text">
                      <MessageCircle className="size-3" aria-hidden="true" />
                      {d.pendingWhatsapp}
                    </span>
                  ) : null}
                </div>

                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-accent">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.round((d.total / busiest) * 100)}%` }}
                  />
                </div>

                <div className="mt-1 text-xs tabular-nums">
                  {d.total > 0 ? (
                    <span className="font-medium">{d.total}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                  <span className="text-muted-foreground"> appt{d.total === 1 ? "" : "s"}</span>
                </div>

                {/* A count, not names: the names are in the hover card, but a
                    touch device gets no hover — it must still see who's in. */}
                <div className="mt-auto pt-1 text-[0.65rem] text-muted-foreground">
                  {visiting.length > 0
                    ? `${visiting.length} doctor${visiting.length === 1 ? "" : "s"}`
                    : "No doctor"}
                </div>
              </Link>

              {/* Hover/focus card. `pointer-events-none` so it never eats the
                  click on the cell underneath. */}
              <div
                role="tooltip"
                className={cn(
                  "pointer-events-none absolute z-30 hidden w-64 rounded-lg border bg-popover p-3 text-left shadow-lg",
                  "group-hover:block group-focus-within:block",
                  column >= 5 ? "right-0" : "left-0",
                  bottomRow ? "bottom-full mb-1" : "top-full mt-1",
                )}
              >
                <div className="text-sm font-medium">{longDate(d.date)}</div>

                <div className="mt-1.5 text-xs text-muted-foreground">
                  {d.total === 0 ? (
                    "No appointments booked."
                  ) : (
                    <>
                      <span className="font-medium text-foreground">{d.total}</span> appointment
                      {d.total === 1 ? "" : "s"} · {d.consultation} consultation · {d.procedure}{" "}
                      procedure · {d.both} both
                    </>
                  )}
                </div>

                <div className="mt-2 border-t pt-2">
                  <div className="text-xs font-medium">Doctors available</div>
                  {d.doctors.length === 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      None scheduled for this day.
                    </p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {d.doctors.map((doc) => (
                        <li key={doc.id} className="text-xs">
                          <span
                            className={cn(
                              "font-medium",
                              doc.onLeave && "text-muted-foreground line-through",
                            )}
                          >
                            {doc.name}
                          </span>
                          <span className="text-muted-foreground">
                            {doc.onLeave
                              ? " — on leave"
                              : doc.flexible
                                ? "" // Hours aren't enforced: there is no window to quote.
                                : ` — ${doc.windows.join(", ")}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
