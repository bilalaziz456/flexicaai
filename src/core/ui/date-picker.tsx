"use client";

import { useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { cn } from "@/core/lib/utils";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad = (n: number) => String(n).padStart(2, "0");
const fmtYMD = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;

/** "YYYY-MM-DD" → {y, m0 (0-11), d} or null. */
function parseYMD(s: string): { y: number; m0: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  if (!m) return null;
  return { y: Number(m[1]), m0: Number(m[2]) - 1, d: Number(m[3]) };
}

function todayParts() {
  const t = new Date();
  return { y: t.getFullYear(), m0: t.getMonth(), d: t.getDate() };
}

const triggerCls =
  "flex h-8 w-full items-center gap-2 rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm text-left outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[popup-open]:border-ring";

// Month/year quick-nav selects in the popover header (fast jumps for e.g. DOB).
const navSelectCls =
  "h-7 rounded-md border border-input bg-[var(--input-bg)] px-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Themed date picker — a calendar popover built from app tokens (not the native
 * <input type="date">, whose popup can't be styled). Controlled; value is
 * "YYYY-MM-DD" (matching the old native input). Past dates are allowed. CORE.
 */
export function DatePicker({
  value,
  onChange,
  id,
  disabled,
  ariaLabel = "Date",
}: {
  value: string;
  onChange: (next: string) => void;
  id?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const base = parseYMD(value) ?? todayParts();
  const [view, setView] = useState({ y: base.y, m0: base.m0 });

  // When the popover opens, jump the visible month to the selected date (or today).
  useEffect(() => {
    if (!open) return;
    const b = parseYMD(value) ?? todayParts();
    setView({ y: b.y, m0: b.m0 });
  }, [open, value]);

  const selected = parseYMD(value);
  const today = todayParts();

  // 6 weeks of cells starting on the Sunday on/before the 1st of the view month.
  const startWeekday = new Date(view.y, view.m0, 1).getDay();
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(view.y, view.m0, 1 - startWeekday + i);
    return { y: d.getFullYear(), m0: d.getMonth(), d: d.getDate() };
  });

  const label = selected
    ? new Date(selected.y, selected.m0, selected.d).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "";

  const shiftMonth = (delta: number) => {
    const d = new Date(view.y, view.m0 + delta, 1);
    setView({ y: d.getFullYear(), m0: d.getMonth() });
  };

  // Year options (descending, recent first): 100 years back to 10 years ahead —
  // covers birth dates AND future appointments. Extended to include the current
  // view/selected year if it falls outside that window.
  const yEnd = Math.max(today.y + 10, view.y, selected?.y ?? today.y);
  const yStart = Math.min(today.y - 100, view.y, selected?.y ?? today.y);
  const years = Array.from({ length: yEnd - yStart + 1 }, (_, i) => yEnd - i);

  const pick = (c: { y: number; m0: number; d: number }) => {
    onChange(fmtYMD(c.y, c.m0, c.d));
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        id={id}
        disabled={disabled}
        aria-label={ariaLabel}
        className={triggerCls}
      >
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className={cn("flex-1 truncate", !label && "text-muted-foreground")}>
          {label || "Pick a date"}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-50">
          <Popover.Popup className="w-[17rem] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg outline-none">
            <div className="mb-2 flex items-center justify-between gap-1">
              <div className="flex items-center gap-1">
                <select
                  aria-label="Month"
                  value={view.m0}
                  onChange={(e) =>
                    setView((v) => ({ ...v, m0: Number(e.target.value) }))
                  }
                  className={navSelectCls}
                >
                  {MONTHS.map((mn, i) => (
                    <option key={mn} value={i}>
                      {mn}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Year"
                  value={view.y}
                  onChange={(e) =>
                    setView((v) => ({ ...v, y: Number(e.target.value) }))
                  }
                  className={navSelectCls}
                >
                  {years.map((yr) => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => shiftMonth(-1)}
                  className="inline-flex size-7 items-center justify-center rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50 hover:bg-accent hover:text-accent-foreground"
                >
                  <ChevronLeft className="size-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() => shiftMonth(1)}
                  className="inline-flex size-7 items-center justify-center rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50 hover:bg-accent hover:text-accent-foreground"
                >
                  <ChevronRight className="size-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-0.5">
              {WEEKDAYS.map((w) => (
                <div
                  key={w}
                  className="flex h-7 items-center justify-center text-xs font-medium text-muted-foreground"
                >
                  {w}
                </div>
              ))}
              {cells.map((c, i) => {
                const inMonth = c.m0 === view.m0;
                const isSelected =
                  selected && c.y === selected.y && c.m0 === selected.m0 && c.d === selected.d;
                const isToday = c.y === today.y && c.m0 === today.m0 && c.d === today.d;
                return (
                  <button
                    key={i}
                    type="button"
                    aria-pressed={Boolean(isSelected)}
                    onClick={() => pick(c)}
                    className={cn(
                      "flex h-8 items-center justify-center rounded-md text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                      !inMonth && "text-muted-foreground/50",
                      inMonth && !isSelected && "hover:bg-accent hover:text-accent-foreground",
                      isSelected && "bg-primary font-medium text-primary-foreground",
                      isToday && !isSelected && "ring-1 ring-primary/40",
                    )}
                  >
                    {c.d}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
              <button
                type="button"
                onClick={() => onChange("")}
                className="rounded-sm text-xs text-muted-foreground underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 hover:underline"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => {
                  const t = todayParts();
                  pick(t);
                }}
                className="rounded-sm text-xs font-medium text-primary-text underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 hover:underline"
              >
                Today
              </button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
