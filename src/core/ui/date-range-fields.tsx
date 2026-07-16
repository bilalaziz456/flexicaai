"use client";

import { DatePicker } from "@/core/ui/date-picker";
import { Label } from "@/core/ui/label";

/**
 * A From + To date-range pair rendered as ONE wrapping unit, so the two pickers
 * always sit next to each other on the same row (they never split across rows when
 * the surrounding filter bar wraps). Shared by every filter bar for a consistent
 * layout. Each picker is a controlled value + onChange; `idPrefix` keeps the input
 * ids unique when a page hosts more than one range.
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
        <div className="w-40">
          <DatePicker id={fromId} ariaLabel="From date" value={from} onChange={onFrom} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={toId} className={labelCls}>To</Label>
        <div className="w-40">
          <DatePicker id={toId} ariaLabel="To date" value={to} onChange={onTo} />
        </div>
      </div>
    </div>
  );
}
