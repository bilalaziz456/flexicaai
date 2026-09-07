"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { WEEKDAYS, timeToMinutes } from "@/core/lib/availability";
import type { ClinicHour } from "@/core/lib/clinic-hours";
import { Label } from "@/core/ui/label";
import { TimeSelect } from "@/core/ui/time-select";
import { syncChecked } from "@/core/ui/checkbox-sync";

type Range = { start: string; end: string };
type DayState = { weekday: number; open: boolean; ranges: Range[] };

const DEFAULT_RANGE: Range = { start: "10:00", end: "21:00" };
const rangeValid = (r: Range) => {
  const s = timeToMinutes(r.start);
  const e = timeToMinutes(r.end);
  return s !== null && e !== null && s < e;
};

/**
 * The clinic's PUBLIC address and OPENING HOURS — the two things a patient asks over
 * WhatsApp ("where are you?", "what time do you open?") and the only two the assistant
 * can answer from the clinic's own words.
 *
 * IN `core/ui` BECAUSE TWO PANELS RENDER IT (ADR-019): the clinic admin edits its own
 * details on /clinic/settings, and the super admin fills them in at onboarding, when
 * they already have both from the sales call. A clinic that has not logged in yet
 * would otherwise send every such message to a human for its first week.
 *
 * FIELDS ONLY — no <form>, no action, no submit button. The containing panel owns
 * submission, because create and edit post to different actions, and a shared
 * component that knew either would know about routes.
 *
 * Hours are per day with SEVERAL WINDOWS EACH, because that is what clinics here
 * actually do: a Friday that opens, breaks for Jummah and reopens is normal, so one
 * start/end per day would have been wrong on day one. A day with no windows is CLOSED,
 * which is itself a real answer — "Sun: Closed" beats silence about Sunday.
 *
 * Mirrors `DoctorScheduleFields`: same day rows, same `TimeSelect`, same add/remove,
 * and the same trick of emitting JSON through a hidden input so the form submits it
 * like any other field. Two editors that behave alike are two you learn once.
 */
export function PublicContactFields({
  address,
  hours,
  onInvalidChange,
  addressHint,
  hoursHint,
}: {
  address: string | null;
  hours: ClinicHour[] | null;
  /** Lets the containing form disable its submit while a time range is backwards. */
  onInvalidChange?: (invalid: boolean) => void;
  addressHint?: React.ReactNode;
  hoursHint?: React.ReactNode;
}) {
  const [addr, setAddr] = useState(address ?? "");
  const [days, setDays] = useState<DayState[]>(() =>
    WEEKDAYS.map((d) => {
      const mine = (hours ?? []).filter((h) => h.weekday === d.value);
      return {
        weekday: d.value,
        open: mine.length > 0,
        ranges:
          mine.length > 0 ? mine.map((h) => ({ start: h.start, end: h.end })) : [DEFAULT_RANGE],
      };
    }),
  );

  const patch = (weekday: number, p: Partial<DayState>) =>
    setDays((prev) => prev.map((d) => (d.weekday === weekday ? { ...d, ...p } : d)));
  const setRange = (weekday: number, i: number, p: Partial<Range>) =>
    setDays((prev) =>
      prev.map((d) =>
        d.weekday === weekday
          ? { ...d, ranges: d.ranges.map((r, j) => (j === i ? { ...r, ...p } : r)) }
          : d,
      ),
    );
  const addRange = (weekday: number) =>
    setDays((prev) =>
      prev.map((d) =>
        d.weekday === weekday ? { ...d, ranges: [...d.ranges, { ...DEFAULT_RANGE }] } : d,
      ),
    );
  const removeRange = (weekday: number, i: number) =>
    setDays((prev) =>
      prev.map((d) =>
        d.weekday === weekday ? { ...d, ranges: d.ranges.filter((_, j) => j !== i) } : d,
      ),
    );

  // Open days x their windows, flattened the way the column stores them.
  const flat: ClinicHour[] = days
    .filter((d) => d.open)
    .flatMap((d) => d.ranges.map((r) => ({ weekday: d.weekday, start: r.start, end: r.end })));
  const invalid = days.some((d) => d.open && d.ranges.some((r) => !rangeValid(r)));

  useEffect(() => {
    onInvalidChange?.(invalid);
  }, [invalid, onInvalidChange]);

  return (
    <>
      <input type="hidden" name="openingHours" value={JSON.stringify(flat)} />

      <div className="space-y-2">
        <Label htmlFor="publicAddress">Address patients are given</Label>
        <textarea
          id="publicAddress"
          name="publicAddress"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          rows={3}
          maxLength={400}
          placeholder="e.g. 12-C, Main Boulevard, Gulberg III, Lahore"
          className="w-full rounded-lg border border-input bg-[var(--input-bg)] px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <p className="text-xs text-muted-foreground">
          {addressHint ?? (
            <>
              Sent to a patient who asks where the clinic is. Leave blank and we pass the
              question to the front desk instead.
            </>
          )}
        </p>
      </div>

      <div className="space-y-2">
        <Label>Opening hours</Label>
        <div className="space-y-2 rounded-md border p-3">
          {WEEKDAYS.map((d) => {
            const day = days.find((x) => x.weekday === d.value)!;
            return (
              <div
                key={d.value}
                className="flex flex-wrap items-start gap-3 border-b pb-2 last:border-0 last:pb-0"
              >
                {/* w-full on a phone: the day name takes its own line, or the time
                    controls overflow the row. */}
                <label className="flex w-full shrink-0 items-center gap-2 pt-1.5 text-sm sm:w-32">
                  <input
                    type="checkbox"
                    checked={day.open}
                    ref={syncChecked(day.open)}
                    onChange={(e) => patch(d.value, { open: e.target.checked })}
                    className="size-4 accent-[var(--color-primary)]"
                  />
                  <span className="font-medium">{d.label}</span>
                </label>

                {!day.open ? (
                  <span className="pt-1.5 text-sm text-muted-foreground">Closed</span>
                ) : (
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    {day.ranges.map((r, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <TimeSelect
                          value={r.start}
                          onChange={(v) => setRange(d.value, i, { start: v })}
                          ariaLabel={`${d.label} opens`}
                        />
                        <span className="text-xs text-muted-foreground">to</span>
                        <TimeSelect
                          value={r.end}
                          onChange={(v) => setRange(d.value, i, { end: v })}
                          ariaLabel={`${d.label} closes`}
                        />
                        {day.ranges.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => removeRange(d.value, i)}
                            aria-label={`Remove this ${d.label} time`}
                            className="rounded-md p-1 text-muted-foreground hover:bg-accent"
                          >
                            <X className="size-4" />
                          </button>
                        ) : null}
                        {!rangeValid(r) ? (
                          <span className="text-xs text-destructive">
                            Closing time must be after opening.
                          </span>
                        ) : null}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => addRange(d.value)}
                      className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <Plus className="size-3.5" /> Add another time
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {hoursHint ?? (
            <>
              Shown to patients who ask about timings. Add a second time for a day that
              closes in between &mdash; a Friday Jummah break, for example. This does{" "}
              <span className="font-medium">not</span>{" "}
              decide when appointments can be booked; that comes from each doctor&apos;s
              own working hours, and a patient asking about timings is told both.
            </>
          )}
        </p>
      </div>
    </>
  );
}
