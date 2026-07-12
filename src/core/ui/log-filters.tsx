"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Select } from "@base-ui/react/select";
import { Check, ChevronsUpDown } from "lucide-react";
import { DatePicker } from "@/core/ui/date-picker";
import { Label } from "@/core/ui/label";

/**
 * Date-range + actor filter bar for the activity-log pages (clinic + admin).
 * Route-agnostic; pushes `from`/`to`/`actor` query params the server page reads.
 * The actor dropdown is a themed Base UI Select (no system-blue on hover).
 */
export function LogFilters({
  from,
  to,
  actor,
  actors,
}: {
  from: string;
  to: string;
  actor: string;
  actors: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [fromD, setFromD] = useState(from);
  const [toD, setToD] = useState(to);
  const [actorV, setActorV] = useState(actor);

  function push(next: { from?: string; to?: string; actor?: string }) {
    const f = next.from ?? fromD;
    const t = next.to ?? toD;
    const a = next.actor ?? actorV;
    const params = new URLSearchParams();
    if (f) params.set("from", f);
    if (t) params.set("to", t);
    if (a) params.set("actor", a);
    const s = params.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }

  const clear = () => {
    setFromD("");
    setToD("");
    setActorV("");
    router.replace(pathname, { scroll: false });
  };

  const items: Record<string, string> = {
    "": "All users",
    ...Object.fromEntries(actors.map((a) => [a, a])),
  };
  const hasFilters = Boolean(fromD || toD || actorV);

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
        <Label className="text-xs text-muted-foreground">Actor</Label>
        <Select.Root
          items={items}
          value={actorV}
          onValueChange={(next) => {
            const v = (next as string | null) ?? "";
            setActorV(v);
            push({ actor: v });
          }}
        >
          <Select.Trigger
            aria-label="Filter by actor"
            className="inline-flex h-8 w-48 items-center justify-between gap-1.5 rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:border-ring"
          >
            <Select.Value />
            <Select.Icon>
              <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
              <Select.Popup className="z-50 max-h-72 min-w-48 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
                <Select.Item
                  value=""
                  className="flex cursor-default select-none items-center gap-2 rounded-md py-1.5 pl-2 pr-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                >
                  <span className="flex w-4 shrink-0 items-center justify-center">
                    <Select.ItemIndicator>
                      <Check className="size-3.5" aria-hidden="true" />
                    </Select.ItemIndicator>
                  </span>
                  <Select.ItemText>All users</Select.ItemText>
                </Select.Item>
                {actors.map((a) => (
                  <Select.Item
                    key={a}
                    value={a}
                    className="flex cursor-default select-none items-center gap-2 rounded-md py-1.5 pl-2 pr-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                  >
                    <span className="flex w-4 shrink-0 items-center justify-center">
                      <Select.ItemIndicator>
                        <Check className="size-3.5" aria-hidden="true" />
                      </Select.ItemIndicator>
                    </span>
                    <Select.ItemText>{a}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>
      </div>
      {hasFilters ? (
        <button
          type="button"
          onClick={clear}
          className="h-8 rounded-lg border border-input bg-[var(--input-bg)] px-3 text-sm outline-none transition-colors hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
