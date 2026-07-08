"use client";

import { useState } from "react";
import { WEEKDAYS, type DayAvailability } from "@/core/lib/availability";
import { Checkbox } from "@/core/ui/checkbox";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";

type Row = { weekday: number; on: boolean; start: string; end: string };

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
}: {
  defaultAvailability?: DayAvailability[];
  defaultLimit?: number;
  defaultFee?: number;
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

  const update = (weekday: number, patch: Partial<Row>) =>
    setRows((prev) =>
      prev.map((r) => (r.weekday === weekday ? { ...r, ...patch } : r)),
    );

  const availability: DayAvailability[] = rows
    .filter((r) => r.on)
    .map((r) => ({ weekday: r.weekday, start: r.start, end: r.end }));

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="space-y-2">
        <Label>Working days &amp; hours</Label>
        <p className="text-xs text-muted-foreground">
          Enable each day the doctor works and set the hours. Leave all off for no
          time restriction.
        </p>
        <div className="space-y-2">
          {WEEKDAYS.map((d) => {
            const row = rows.find((r) => r.weekday === d.value)!;
            return (
              <div key={d.value} className="flex flex-wrap items-center gap-3">
                <label className="flex w-28 items-center gap-2 text-sm">
                  <Checkbox
                    checked={row.on}
                    onCheckedChange={(v) => update(d.value, { on: Boolean(v) })}
                  />
                  {d.label}
                </label>
                <Input
                  type="time"
                  aria-label={`${d.label} start`}
                  value={row.start}
                  disabled={!row.on}
                  onChange={(e) => update(d.value, { start: e.target.value })}
                  className="h-8 w-32"
                />
                <span className="text-sm text-muted-foreground">to</span>
                <Input
                  type="time"
                  aria-label={`${d.label} end`}
                  value={row.end}
                  disabled={!row.on}
                  onChange={(e) => update(d.value, { end: e.target.value })}
                  className="h-8 w-32"
                />
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
    </div>
  );
}
