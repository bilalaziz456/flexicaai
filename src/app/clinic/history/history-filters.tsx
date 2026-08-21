"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { DateRangeFields } from "@/core/ui/date-range-fields";
import { FilterSelect, PeriodTabs } from "@/core/ui/report-filters";
import { HISTORY_TABS } from "@/core/finance/imported-history-tabs";

const TYPE_OPTIONS = HISTORY_TABS.map((t) => ({ value: t.id, label: t.label }));
const TYPE_LABELS = Object.fromEntries(TYPE_OPTIONS.map((o) => [o.value, o.label]));

// The archive is old data, so default to All time; narrow with these pills or the dates.
const HISTORY_PERIODS = [
  { value: "all", label: "All", title: "All time" },
  { value: "year", label: "Year", title: "Last year" },
  { value: "half", label: "6mo", title: "Last 6 months" },
  { value: "quarter", label: "Quarter", title: "Last quarter" },
];

/** Filter bar for the imported-history archive: type, period + range, text search. */
export function HistoryFilters({
  type,
  period,
  from,
  to,
  q,
}: {
  type: string;
  period: string;
  from: string;
  to: string;
  q: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [typeV, setTypeV] = useState(type);
  const [periodV, setPeriodV] = useState(period);
  const [fromD, setFromD] = useState(from);
  const [toD, setToD] = useState(to);
  const [qV, setQV] = useState(q);

  function push(next: Partial<{ type: string; period: string; from: string; to: string; q: string }>) {
    const ty = next.type ?? typeV;
    const pr = next.period ?? periodV;
    const f = next.from ?? fromD;
    const t = next.to ?? toD;
    const query = next.q ?? qV;
    const params = new URLSearchParams();
    params.set("type", ty);
    params.set("period", pr);
    if (pr === "custom") {
      if (f) params.set("from", f);
      if (t) params.set("to", t);
    }
    if (query) params.set("q", query);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
      <FilterSelect
        label="Type"
        ariaLabel="Filter by transaction type"
        value={typeV}
        items={TYPE_LABELS}
        options={TYPE_OPTIONS}
        onChange={(v) => {
          setTypeV(v);
          push({ type: v });
        }}
      />
      <PeriodTabs
        value={periodV}
        presets={HISTORY_PERIODS}
        onChange={(v) => {
          setPeriodV(v);
          push({ period: v });
        }}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor="hist-q" className="text-xs text-muted-foreground">
          Search
        </label>
        <input
          id="hist-q"
          type="search"
          defaultValue={q}
          placeholder="Patient, doctor, ref or note"
          onChange={(e) => setQV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") push({ q: (e.target as HTMLInputElement).value });
          }}
          onBlur={(e) => push({ q: e.target.value })}
          className="h-9 rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
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
