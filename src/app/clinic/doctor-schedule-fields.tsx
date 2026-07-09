"use client";

import { useState } from "react";
import { WEEKDAYS, type DayAvailability } from "@/core/lib/availability";
import { Checkbox } from "@/core/ui/checkbox";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";

type Row = { weekday: number; on: boolean; start: string; end: string };

const HOURS12 = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0")); // 00,05,..55

/** "HH:MM" (24h) → 12-hour parts. */
function to12(hhmm: string): { hour12: number; minute: string; mer: "AM" | "PM" } {
  const [h, m] = hhmm.split(":").map(Number);
  const hour = Number.isFinite(h) ? h : 9;
  const min = Number.isFinite(m) ? m : 0;
  const mer = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return { hour12, minute: String(min).padStart(2, "0"), mer };
}

/** 12-hour parts → "HH:MM" (24h). */
function to24(hour12: number, minute: string, mer: "AM" | "PM"): string {
  let h = hour12 % 12;
  if (mer === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${minute}`;
}

const timeSelectCls =
  "h-8 min-w-0 flex-1 rounded-lg border border-input bg-[var(--input-bg)] px-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50";

/**
 * A time picker built from native <select>s (hour / minute / AM-PM) instead of
 * <input type="time"> — no clock icon and the AM/PM renders consistently on every
 * device (native time inputs clip/vary across browsers). Value is "HH:MM" (24h).
 */
function TimeSelect({
  value,
  disabled,
  onChange,
  ariaLabel,
}: {
  value: string;
  disabled?: boolean;
  onChange: (next: string) => void;
  ariaLabel: string;
}) {
  const { hour12, minute, mer } = to12(value);
  const minuteOptions = MINUTES.includes(minute) ? MINUTES : [...MINUTES, minute].sort();

  return (
    <div className="flex flex-1 items-center gap-1">
      <select
        aria-label={`${ariaLabel} hour`}
        disabled={disabled}
        value={hour12}
        onChange={(e) => onChange(to24(Number(e.target.value), minute, mer))}
        className={timeSelectCls}
      >
        {HOURS12.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="text-muted-foreground">:</span>
      <select
        aria-label={`${ariaLabel} minute`}
        disabled={disabled}
        value={minute}
        onChange={(e) => onChange(to24(hour12, e.target.value, mer))}
        className={timeSelectCls}
      >
        {minuteOptions.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <select
        aria-label={`${ariaLabel} AM or PM`}
        disabled={disabled}
        value={mer}
        onChange={(e) => onChange(to24(hour12, minute, e.target.value as "AM" | "PM"))}
        className={`${timeSelectCls} w-16 flex-none`}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}

/**
 * Doctor working-days/hours + daily-limit editor. Emits the schedule as a hidden
 * `availability` JSON input and the cap as `dailyLimit`, so the containing
 * <form> submits them like any other field. Reused by the add-staff and
 * edit-schedule forms.
 */
export function DoctorScheduleFields({
  defaultAvailability = [],
  defaultLimit = 0,
  defaultFee = 0,
  defaultFlexible = false,
}: {
  defaultAvailability?: DayAvailability[];
  defaultLimit?: number;
  defaultFee?: number;
  defaultFlexible?: boolean;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    WEEKDAYS.map((d) => {
      const slot = defaultAvailability.find((a) => a.weekday === d.value);
      return {
        weekday: d.value,
        on: Boolean(slot),
        start: slot?.start ?? "09:00",
        end: slot?.end ?? "17:00",
      };
    }),
  );
  const [limit, setLimit] = useState(String(defaultLimit ?? 0));
  const [fee, setFee] = useState(String(defaultFee ?? 0));
  const [flexible, setFlexible] = useState(Boolean(defaultFlexible));

  const update = (weekday: number, patch: Partial<Row>) =>
    setRows((prev) =>
      prev.map((r) => (r.weekday === weekday ? { ...r, ...patch } : r)),
    );

  const availability: DayAvailability[] = rows
    .filter((r) => r.on)
    .map((r) => ({ weekday: r.weekday, start: r.start, end: r.end }));

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
            const row = rows.find((r) => r.weekday === d.value)!;
            return (
              <div
                key={d.value}
                className="flex flex-col gap-2 rounded-md border p-2 sm:flex-row sm:items-center sm:gap-3 sm:border-0 sm:p-0"
              >
                <label className="flex items-center gap-2 text-sm sm:w-28">
                  <Checkbox
                    checked={row.on}
                    onCheckedChange={(v) => update(d.value, { on: Boolean(v) })}
                  />
                  {d.label}
                </label>
                <div className="flex flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="w-9 shrink-0 text-xs text-muted-foreground sm:hidden">
                      From
                    </span>
                    <TimeSelect
                      ariaLabel={`${d.label} start`}
                      value={row.start}
                      disabled={!row.on}
                      onChange={(v) => update(d.value, { start: v })}
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
                      ariaLabel={`${d.label} end`}
                      value={row.end}
                      disabled={!row.on}
                      onChange={(v) => update(d.value, { end: v })}
                    />
                  </div>
                </div>
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
