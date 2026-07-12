"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Select } from "@base-ui/react/select";
import { Check, ChevronsUpDown } from "lucide-react";
import { DatePicker } from "@/core/ui/date-picker";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "scheduled", label: "Scheduled" },
  { value: "confirmed", label: "Confirmed" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "no_show", label: "No-show" },
];
const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  STATUS_OPTIONS.map((o) => [o.value, o.label]),
);

/**
 * Date-range + text filter bar for the appointment lists (clinic + reception).
 * Route-agnostic (uses the current pathname). Pushes `from`/`to`/`q` query
 * params; the server page reads them and filters. Search is debounced; date
 * changes apply immediately. A "Today" button resets the range to today.
 */
export function AppointmentFilters({
  from,
  to,
  q,
  status,
  today,
}: {
  from: string;
  to: string;
  q: string;
  status: string;
  today: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [fromD, setFromD] = useState(from);
  const [toD, setToD] = useState(to);
  const [query, setQuery] = useState(q);
  const [statusV, setStatusV] = useState(status);

  function push(next: {
    from?: string;
    to?: string;
    q?: string;
    status?: string;
  }) {
    const f = next.from ?? fromD;
    const t = next.to ?? toD;
    const qq = next.q ?? query;
    const st = next.status ?? statusV;
    const params = new URLSearchParams();
    if (f) params.set("from", f);
    if (t) params.set("to", t);
    if (qq.trim()) params.set("q", qq.trim());
    if (st) params.set("status", st);
    const s = params.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }

  // Debounce the search box; skip the initial mount so we don't navigate on load.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => push({ q: query }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const resetToday = () => {
    setFromD(today);
    setToD(today);
    push({ from: today, to: today });
  };

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
      <div className="space-y-1">
        <Label htmlFor="from" className="text-xs text-muted-foreground">
          From
        </Label>
        <div className="w-40">
          <DatePicker
            id="from"
            ariaLabel="From date"
            value={fromD}
            onChange={(v) => {
              setFromD(v);
              push({ from: v });
            }}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="to" className="text-xs text-muted-foreground">
          To
        </Label>
        <div className="w-40">
          <DatePicker
            id="to"
            ariaLabel="To date"
            value={toD}
            onChange={(v) => {
              setToD(v);
              push({ to: v });
            }}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Status</Label>
        <Select.Root
          items={STATUS_LABELS}
          value={statusV}
          onValueChange={(next) => {
            const v = (next as string | null) ?? "";
            setStatusV(v);
            push({ status: v });
          }}
        >
          <Select.Trigger
            aria-label="Filter by status"
            className="inline-flex h-8 w-40 items-center justify-between gap-1.5 rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:border-ring"
          >
            <Select.Value />
            <Select.Icon>
              <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
              <Select.Popup className="z-50 min-w-40 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
                {STATUS_OPTIONS.map((o) => (
                  <Select.Item
                    key={o.value}
                    value={o.value}
                    className="flex cursor-default select-none items-center gap-2 rounded-md py-1.5 pl-2 pr-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                  >
                    <span className="flex w-4 shrink-0 items-center justify-center">
                      <Select.ItemIndicator>
                        <Check className="size-3.5" aria-hidden="true" />
                      </Select.ItemIndicator>
                    </span>
                    <Select.ItemText>{o.label}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <Label htmlFor="q" className="text-xs text-muted-foreground">
          Search
        </Label>
        <Input
          id="q"
          placeholder="Search patient name or phone…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <button
        type="button"
        onClick={resetToday}
        className="h-8 rounded-lg border border-input bg-[var(--input-bg)] px-3 text-sm outline-none transition-colors hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Today
      </button>
    </div>
  );
}
