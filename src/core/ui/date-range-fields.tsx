"use client";

import { DatePicker } from "@/core/ui/date-picker";
import { Label } from "@/core/ui/label";

/**
 * A From + To date-range pair rendered as ONE wrapping unit, so the two pickers
 * always sit next to each other on the same row (they never split across rows when
 * the surrounding filter bar wraps). Shared by every filter bar for a consistent
 * layout. Each picker is a controlled value + onChange; `idPrefix` keeps the input
 * ids unique when a page hosts more than one range.
 *
 * WIDTH IS MEASURED, NOT GUESSED. At `w-40` the field was narrower than the label it
 * always shows: 160px leaves the text 114px after the icon, gap and padding, while
 * `DatePicker` renders "Tue, 22 Sept 2026" (119px) and, at worst, "Wed, 22 Sept 2026"
 * (127px). The span truncates, so what got cut was the tail — the YEAR, the one part
 * a reader cannot infer — leaving "Tue, 22 Sept 20…" in every report filter bar in
 * the app. `w-48` gives the text 146px, which clears the worst case with room for a
 * wider font rather than by three pixels. Narrowing the format instead was the
 * alternative, and the weekday is worth keeping: these same pickers book
 * appointments, where "is that a Sunday" is the question being asked.
 */
export function DateRangeFields({
  from,
  to,
  onFrom,
  onTo,
  idPrefix = "",
}: {
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  idPrefix?: string;
}) {
  const fromId = `${idPrefix}from`;
  const toId = `${idPrefix}to`;
  const labelCls = "text-xs font-normal text-muted-foreground";
  return (
    <div className="flex items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={fromId} className={labelCls}>From</Label>
        <div className="w-48">
          <DatePicker id={fromId} ariaLabel="From date" value={from} onChange={onFrom} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={toId} className={labelCls}>To</Label>
        <div className="w-48">
          <DatePicker id={toId} ariaLabel="To date" value={to} onChange={onTo} />
        </div>
      </div>
    </div>
  );
}
