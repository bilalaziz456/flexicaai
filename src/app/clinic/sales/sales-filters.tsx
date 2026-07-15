"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Select } from "@base-ui/react/select";
import { Check, ChevronsUpDown } from "lucide-react";
import { DatePicker } from "@/core/ui/date-picker";
import { Label } from "@/core/ui/label";

const PERIOD_OPTIONS: { value: string; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "30d", label: "Last 30 days" },
  { value: "quarter", label: "Last quarter" },
  { value: "half", label: "Last 6 months" },
  { value: "year", label: "Last year" },
  { value: "custom", label: "Custom range" },
];
const PERIOD_LABELS: Record<string, string> = Object.fromEntries(
  PERIOD_OPTIONS.map((o) => [o.value, o.label]),
);

const fieldCls = "flex flex-col gap-1.5";
const labelCls = "text-xs font-normal text-muted-foreground";
const triggerCls =
  "inline-flex h-8 items-center justify-between gap-1.5 rounded-lg border border-input bg-[var(--input-bg)] pl-2.5 pr-3.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:border-ring";

/** A themed Base UI select matching the appointment/log filter bars. */
function FilterSelect({
  label,
  ariaLabel,
  value,
  items,
  options,
  onChange,
  className,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  items: Record<string, string>;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={fieldCls}>
      <Label className={labelCls}>{label}</Label>
      <Select.Root
        items={items}
        value={value}
        onValueChange={(next) => onChange((next as string | null) ?? "")}
      >
        <Select.Trigger aria-label={ariaLabel} className={`${triggerCls} ${className ?? "w-44"}`}>
          <Select.Value />
          <Select.Icon>
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
            <Select.Popup className="z-50 min-w-40 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
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
    </div>
  );
}

/**
 * Filter bar for the Sales report: a period preset, a doctor filter, and a custom
 * from/to range. Changing a date switches the period to "Custom" automatically;
 * picking a non-custom preset drops the custom dates. Pushes query params the
 * server page reads.
 */
export function SalesFilters({
  period,
  from,
  to,
  doctorId,
  doctors,
  showDoctor = true,
}: {
  period: string;
  from: string;
  to: string;
  doctorId: string;
  doctors: { id: string; name: string }[];
  /** Hide the doctor filter (e.g. a doctor's self-scoped shares view). */
  showDoctor?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [periodV, setPeriodV] = useState(period);
  const [fromD, setFromD] = useState(from);
  const [toD, setToD] = useState(to);
  const [doctorV, setDoctorV] = useState(doctorId);

  function push(next: {
    period?: string;
    from?: string;
    to?: string;
    doctorId?: string;
  }) {
    const pr = next.period ?? periodV;
    const f = next.from ?? fromD;
    const t = next.to ?? toD;
    const doc = next.doctorId ?? doctorV;
    const params = new URLSearchParams();
    params.set("period", pr);
    if (pr === "custom") {
      if (f) params.set("from", f);
      if (t) params.set("to", t);
    }
    if (doc) params.set("doctorId", doc);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const doctorOptions = [
    { value: "", label: "All doctors" },
    ...doctors.map((d) => ({ value: d.id, label: d.name })),
  ];
  const doctorItems = Object.fromEntries(doctorOptions.map((o) => [o.value, o.label]));

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
      <FilterSelect
        label="Period"
        ariaLabel="Filter by period"
        value={periodV}
        items={PERIOD_LABELS}
        options={PERIOD_OPTIONS}
        onChange={(v) => {
          setPeriodV(v);
          push({ period: v });
        }}
      />
      {showDoctor ? (
        <FilterSelect
          label="Doctor"
          ariaLabel="Filter by doctor"
          value={doctorV}
          items={doctorItems}
          options={doctorOptions}
          onChange={(v) => {
            setDoctorV(v);
            push({ doctorId: v });
          }}
        />
      ) : null}
      <div className={fieldCls}>
        <Label htmlFor="from" className={labelCls}>
          From
        </Label>
        <div className="w-44">
          <DatePicker
            id="from"
            ariaLabel="From date"
            value={fromD}
            onChange={(v) => {
              setFromD(v);
              setPeriodV("custom");
              push({ period: "custom", from: v });
            }}
          />
        </div>
      </div>
      <div className={fieldCls}>
        <Label htmlFor="to" className={labelCls}>
          To
        </Label>
        <div className="w-44">
          <DatePicker
            id="to"
            ariaLabel="To date"
            value={toD}
            onChange={(v) => {
              setToD(v);
              setPeriodV("custom");
              push({ period: "custom", to: v });
            }}
          />
        </div>
      </div>
    </div>
  );
}
