"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Select } from "@base-ui/react/select";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { DatePicker } from "@/core/ui/date-picker";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";

type Option = { value: string; label: string };

/** Themed single-select (Base UI) — matches the activity-log filter bar. */
function FilterSelect({
  ariaLabel,
  value,
  options,
  onChange,
  width = "w-44",
  disabled = false,
  placeholder,
}: {
  ariaLabel: string;
  value: string;
  options: Option[];
  onChange: (v: string) => void;
  width?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const items: Record<string, string> = Object.fromEntries(options.map((o) => [o.value, o.label]));
  if (disabled) {
    return (
      <div
        aria-label={ariaLabel}
        aria-disabled="true"
        className={`inline-flex h-8 ${width} cursor-not-allowed items-center justify-between gap-1.5 rounded-lg border border-input bg-[var(--input-bg)] pl-2.5 pr-3.5 text-sm text-muted-foreground opacity-70`}
      >
        <span className="truncate">{placeholder ?? "—"}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
      </div>
    );
  }
  return (
    <Select.Root items={items} value={value} onValueChange={(next) => onChange((next as string | null) ?? "")}>
      <Select.Trigger
        aria-label={ariaLabel}
        className={`inline-flex h-8 ${width} items-center justify-between gap-1.5 rounded-lg border border-input bg-[var(--input-bg)] pl-2.5 pr-3.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:border-ring`}
      >
        <Select.Value />
        <Select.Icon>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
          <Select.Popup className="z-50 max-h-72 min-w-44 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
            {options.map((o) => (
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
  );
}

/**
 * Trash filter bar (clinic + super admin). Search matches label / detail /
 * deleter / clinic; Type narrows to one record kind; Deleted-by to one actor; the
 * date range to a deletion window (no default — empty shows everything). The
 * super admin also gets a Clinic filter (and the actor list is that clinic's
 * staff). Route-agnostic — pushes `q`/`type`/`by`/`from`/`to`/`clinic`.
 */
export function TrashFilters({
  q,
  type,
  by,
  from,
  to,
  clinic,
  typeOptions,
  actors,
  clinics,
}: {
  q: string;
  type: string;
  by: string;
  from: string;
  to: string;
  clinic?: string;
  typeOptions: Option[];
  actors: { id: string; name: string }[];
  clinics?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [qV, setQV] = useState(q);
  const [typeV, setTypeV] = useState(type);
  const [byV, setByV] = useState(by);
  const [fromD, setFromD] = useState(from);
  const [toD, setToD] = useState(to);
  const [clinicV, setClinicV] = useState(clinic ?? "");

  function push(next: Partial<{ q: string; type: string; by: string; from: string; to: string; clinic: string }>) {
    const params = new URLSearchParams();
    const val = (k: keyof typeof next, cur: string) => next[k] ?? cur;
    const q2 = val("q", qV);
    const type2 = val("type", typeV);
    const by2 = val("by", byV);
    const from2 = val("from", fromD);
    const to2 = val("to", toD);
    const clinic2 = val("clinic", clinicV);
    if (q2) params.set("q", q2);
    if (type2) params.set("type", type2);
    if (by2) params.set("by", by2);
    if (from2) params.set("from", from2);
    if (to2) params.set("to", to2);
    if (clinic2) params.set("clinic", clinic2);
    const s = params.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }

  function clearAll() {
    setQV("");
    setTypeV("");
    setByV("");
    setFromD("");
    setToD("");
    setClinicV("");
    router.replace(pathname, { scroll: false });
  }

  const hasFilters = Boolean(qV || typeV || byV || fromD || toD || clinicV);
  const fieldCls = "flex flex-col gap-1.5";
  const labelCls = "text-xs font-normal text-muted-foreground";

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
      <div className={fieldCls}>
        <Label htmlFor="trash-q" className={labelCls}>
          Search
        </Label>
        <div className="relative w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            id="trash-q"
            value={qV}
            onChange={(e) => setQV(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") push({ q: qV });
            }}
            onBlur={() => push({ q: qV })}
            placeholder="Name, reason, deleter…"
            className="h-8 pl-8"
          />
        </div>
      </div>

      {clinics ? (
        <div className={fieldCls}>
          <Label className={labelCls}>Clinic</Label>
          <FilterSelect
            ariaLabel="Filter by clinic"
            value={clinicV}
            onChange={(v) => {
              setClinicV(v);
              setByV(""); // actor list is per-clinic
              push({ clinic: v, by: "" });
            }}
            options={[{ value: "", label: "All clinics" }, ...clinics.map((c) => ({ value: c.id, label: c.name }))]}
          />
        </div>
      ) : null}

      <div className={fieldCls}>
        <Label className={labelCls}>Type</Label>
        <FilterSelect
          ariaLabel="Filter by type"
          value={typeV}
          onChange={(v) => {
            setTypeV(v);
            push({ type: v });
          }}
          options={[{ value: "", label: "All types" }, ...typeOptions]}
        />
      </div>

      <div className={fieldCls}>
        <Label className={labelCls}>Deleted by</Label>
        <FilterSelect
          ariaLabel="Filter by who deleted it"
          value={byV}
          disabled={Boolean(clinics) && !clinicV}
          placeholder="Select a clinic first"
          onChange={(v) => {
            setByV(v);
            push({ by: v });
          }}
          options={[{ value: "", label: "Anyone" }, ...actors.map((a) => ({ value: a.id, label: a.name }))]}
        />
      </div>

      <div className={fieldCls}>
        <Label htmlFor="trash-from" className={labelCls}>
          From
        </Label>
        <div className="w-40">
          <DatePicker
            id="trash-from"
            ariaLabel="Deleted from date"
            value={fromD}
            onChange={(v) => {
              setFromD(v);
              push({ from: v });
            }}
          />
        </div>
      </div>
      <div className={fieldCls}>
        <Label htmlFor="trash-to" className={labelCls}>
          To
        </Label>
        <div className="w-40">
          <DatePicker
            id="trash-to"
            ariaLabel="Deleted to date"
            value={toD}
            onChange={(v) => {
              setToD(v);
              push({ to: v });
            }}
          />
        </div>
      </div>

      {hasFilters ? (
        <div className={fieldCls}>
          <Label className={`${labelCls} invisible`} aria-hidden="true">
            Clear
          </Label>
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-input bg-[var(--input-bg)] px-3 text-sm font-medium outline-none transition-colors hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <X className="size-3.5" aria-hidden="true" />
            Clear
          </button>
        </div>
      ) : null}
    </div>
  );
}
