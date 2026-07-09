"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import {
  timeToMinutes,
  WEEKDAYS,
  type DayAvailability,
} from "@/core/lib/availability";
import { Button } from "@/core/ui/button";
import { Checkbox } from "@/core/ui/checkbox";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { TimeSelect } from "@/core/ui/time-select";

type Range = { start: string; end: string };
type DayState = { weekday: number; on: boolean; ranges: Range[] };

/**
 * Doctor working-days/hours + daily-limit editor. Emits the schedule as a hidden
 * `availability` JSON input and the cap as `dailyLimit`, so the containing
 * <form> submits them like any other field. Reused by the add-staff and
 * edit-schedule forms.
 */
/** True when a range's end is after its start. */
const rangeValid = (r: Range) => {
  const s = timeToMinutes(r.start);
  const e = timeToMinutes(r.end);
  return s !== null && e !== null && s < e;
};

export function DoctorScheduleFields({
  defaultAvailability = [],
  defaultLimit = 0,
  defaultFee = 0,
  defaultFlexible = false,
  onValidChange,
}: {
  defaultAvailability?: DayAvailability[];
  defaultLimit?: number;
  defaultFee?: number;
  defaultFlexible?: boolean;
  /** Reports whether the schedule is valid so the parent can gate submit. */
  onValidChange?: (valid: boolean) => void;
}) {
  const [days, setDays] = useState<DayState[]>(() =>
    WEEKDAYS.map((d) => {
      const ws = defaultAvailability.filter((a) => a.weekday === d.value);
      return {
        weekday: d.value,
        on: ws.length > 0,
        ranges:
          ws.length > 0
            ? ws.map((w) => ({ start: w.start, end: w.end }))
            : [{ start: "09:00", end: "17:00" }],
      };
    }),
  );
  const [limit, setLimit] = useState(String(defaultLimit ?? 0));
  const [fee, setFee] = useState(String(defaultFee ?? 0));
  const [flexible, setFlexible] = useState(Boolean(defaultFlexible));

  const patchDay = (weekday: number, patch: Partial<DayState>) =>
    setDays((prev) =>
      prev.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)),
    );
  const setRange = (weekday: number, i: number, patch: Partial<Range>) =>
    setDays((prev) =>
      prev.map((d) =>
        d.weekday === weekday
          ? { ...d, ranges: d.ranges.map((r, j) => (j === i ? { ...r, ...patch } : r)) }
          : d,
      ),
    );
  const addRange = (weekday: number) =>
    setDays((prev) =>
      prev.map((d) =>
        d.weekday === weekday
          ? { ...d, ranges: [...d.ranges, { start: "09:00", end: "17:00" }] }
          : d,
      ),
    );
  const removeRange = (weekday: number, i: number) =>
    setDays((prev) =>
      prev.map((d) =>
        d.weekday === weekday
          ? { ...d, ranges: d.ranges.filter((_, j) => j !== i) }
          : d,
      ),
    );

  // Flatten enabled days × their ranges into per-window availability entries.
  const availability: DayAvailability[] = days
    .filter((d) => d.on)
    .flatMap((d) =>
      d.ranges.map((r) => ({ weekday: d.weekday, start: r.start, end: r.end })),
    );

  // A range is invalid only when its day is enabled and hours are enforced.
  const hasInvalid =
    !flexible && days.some((d) => d.on && d.ranges.some((r) => !rangeValid(r)));
  useEffect(() => {
    onValidChange?.(!hasInvalid);
  }, [hasInvalid, onValidChange]);

  return (
    <div className="space-y-4 rounded-md border p-3 sm:p-4">
      <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/50">
        <Checkbox
          className="mt-0.5"
          checked={flexible}
          onCheckedChange={(v) => setFlexible(Boolean(v))}
        />
        <div className="space-y-0.5">
          <div className="text-sm font-medium">Flexible hours</div>
          <p className="text-xs text-muted-foreground">
            Book at any time — the working hours below are not enforced. Leave off
            to only allow appointments during the doctor&apos;s visiting hours.
          </p>
        </div>
      </label>

      <div className={`space-y-2 ${flexible ? "opacity-50" : ""}`}>
        <Label>Working days &amp; hours</Label>
        <p className="text-xs text-muted-foreground">
          Enable each day the doctor works and set the hours.
          {flexible ? " (Not enforced while Flexible hours is on.)" : ""}
        </p>
        <div className="space-y-2">
          {WEEKDAYS.map((d) => {
            const day = days.find((x) => x.weekday === d.value)!;
            return (
              <div key={d.value} className="space-y-2 rounded-md border p-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={day.on}
                    onCheckedChange={(v) => patchDay(d.value, { on: Boolean(v) })}
                  />
                  {d.label}
                </label>

                {day.on ? (
                  <div className="space-y-2 sm:pl-6">
                    {day.ranges.map((r, i) => {
                      const invalid = !flexible && !rangeValid(r);
                      return (
                        <div key={i} className="space-y-1">
                          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
                            <div className="flex items-center gap-1.5">
                              <span className="w-9 shrink-0 text-xs text-muted-foreground sm:hidden">
                                From
                              </span>
                              <TimeSelect
                                ariaLabel={`${d.label} start ${i + 1}`}
                                value={r.start}
                                onChange={(v) => setRange(d.value, i, { start: v })}
                              />
                            </div>
                            <span className="hidden text-sm text-muted-foreground sm:inline">
                              to
                            </span>
                            <div className="flex items-center gap-1.5">
                              <span className="w-9 shrink-0 text-xs text-muted-foreground sm:hidden">
                                To
                              </span>
                              <TimeSelect
                                ariaLabel={`${d.label} end ${i + 1}`}
                                value={r.end}
                                onChange={(v) => setRange(d.value, i, { end: v })}
                              />
                              {day.ranges.length > 1 ? (
                                <button
                                  type="button"
                                  onClick={() => removeRange(d.value, i)}
                                  aria-label="Remove time"
                                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                                >
                                  <X className="size-4" aria-hidden="true" />
                                </button>
                              ) : null}
                            </div>
                          </div>
                          {invalid ? (
                            <p className="text-xs text-destructive">
                              End time must be after the start time.
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => addRange(d.value)}
                      className="text-primary"
                    >
                      <Plus className="size-4" aria-hidden="true" /> Add another time
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="dailyLimit">Daily appointment limit</Label>
          <Input
            id="dailyLimit"
            name="dailyLimit"
            type="number"
            min={0}
            max={500}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className="w-40"
          />
          <p className="text-xs text-muted-foreground">
            Max appointments per day. <strong>0 = no limit.</strong>
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="fee">Consultation fee (PKR)</Label>
          <Input
            id="fee"
            name="fee"
            type="number"
            min={0}
            step={100}
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            className="w-40"
          />
          <p className="text-xs text-muted-foreground">
            This doctor&apos;s fee per visit. 0 = not set.
          </p>
        </div>
      </div>

      {/* Submitted with the form. */}
      <input type="hidden" name="availability" value={JSON.stringify(availability)} />
      <input type="hidden" name="flexibleHours" value={flexible ? "true" : "false"} />
    </div>
  );
}
