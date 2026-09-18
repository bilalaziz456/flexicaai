"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SelectField } from "@/core/ui/select-field";
import { Label } from "@/core/ui/label";
import { DateRangeFields } from "@/core/ui/date-range-fields";
import { SearchableSelect } from "@/core/ui/searchable-select";
import { cn } from "@/core/lib/utils";

export const filterFieldCls = "flex flex-col gap-1.5";
export const filterLabelCls = "text-xs font-normal text-muted-foreground";
const fieldCls = filterFieldCls;
const labelCls = filterLabelCls;

/** Preset ranges as one-tap pills (short labels). "Custom" is NOT here — editing the
 *  date fields is the custom path (it auto-switches, lighting no pill). */
export const PERIOD_PRESETS: { value: string; label: string; title: string }[] = [
  { value: "today", label: "Today", title: "Today" },
  { value: "30d", label: "30d", title: "Last 30 days" },
  { value: "quarter", label: "Quarter", title: "Last quarter" },
  { value: "half", label: "6mo", title: "Last 6 months" },
  { value: "year", label: "Year", title: "Last year" },
  { value: "all", label: "All", title: "All time" },
];

/**
 * Segmented period picker — one-tap pills instead of a dropdown. The active preset is
 * filled; when the range is "custom" (the user edited a date) NO pill is lit. Wraps on
 * narrow screens. Pairs with the always-visible date fields, which own the custom path.
 */
export function PeriodTabs({
  value,
  onChange,
  label = "Period",
  presets = PERIOD_PRESETS,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  /** Override the preset pills (e.g. the appointments list uses forward windows). */
  presets?: { value: string; label: string; title: string }[];
}) {
  return (
    <div className={fieldCls}>
      <Label className={labelCls}>{label}</Label>
      <div
        role="group"
        aria-label="Filter by period"
        className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-input bg-[var(--input-bg)] p-0.5"
      >
        {presets.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              title={o.title}
              aria-pressed={active}
              onClick={() => onChange(o.value)}
              className={cn(
                "h-7 rounded-md px-2.5 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
/**
 * A labelled dropdown for a filter bar.
 *
 * It used to carry its own copy of the Base UI Select markup — trigger, positioner,
 * popup, item, indicator — which is how six near-identical copies of that markup came
 * to exist. It is a `SelectField` with a label above it now, and that is all it ever
 * was. Delegating also inherits the popup's `z-[110]`, so a filter dropdown opened
 * inside a dialog no longer renders behind it.
 */
export function FilterSelect({
  label,
  ariaLabel,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  /** Accepted and ignored — `SelectField` derives the label map from `options`. */
  items?: Record<string, string>;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={fieldCls}>
      <Label className={labelCls}>{label}</Label>
      <SelectField
        value={value}
        onValueChange={onChange}
        options={options}
        ariaLabel={ariaLabel}
        className={className ?? "w-44"}
      />
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

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
      <PeriodTabs
        value={periodV}
        onChange={(v) => {
          setPeriodV(v);
          push({ period: v });
        }}
      />
      {showDoctor ? (
        <SearchableSelect
          label="Doctor"
          ariaLabel="Filter by doctor"
          value={doctorV}
          options={doctorOptions}
          onChange={(v) => {
            setDoctorV(v);
            push({ doctorId: v });
          }}
        />
      ) : null}
      <DateRangeFields
        from={fromD}
        to={toD}
        onFrom={(v) => {
          setFromD(v);
          setPeriodV("custom");
          push({ period: "custom", from: v });
        }}
        onTo={(v) => {
          setToD(v);
          setPeriodV("custom");
          push({ period: "custom", to: v });
        }}
      />
    </div>
  );
}
