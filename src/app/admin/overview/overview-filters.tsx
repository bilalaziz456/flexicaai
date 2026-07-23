"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  FilterSelect,
  PERIOD_LABELS,
  PERIOD_OPTIONS,
} from "@/app/clinic/sales/sales-filters";
import { DateRangeFields } from "@/core/ui/date-range-fields";

const DAYS_OPTIONS = [
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
  { value: "21", label: "21 days" },
  { value: "30", label: "30 days" },
  { value: "45", label: "45 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
];
const DAYS_LABELS = Object.fromEntries(DAYS_OPTIONS.map((o) => [o.value, o.label]));

/**
 * Overview filter bar — the engagement PERIOD (reuses the sales-report presets) and
 * the configurable CHURN THRESHOLD (a clinic quiet for ≥ this many days is at risk).
 * Pushes both as query params the server page reads.
 */
export function OverviewFilters({
  period,
  from,
  to,
  days,
}: {
  period: string;
  from: string;
  to: string;
  days: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [periodV, setPeriodV] = useState(period);
  const [fromD, setFromD] = useState(from);
  const [toD, setToD] = useState(to);
  const [daysV, setDaysV] = useState(days);

  function push(next: Partial<{ period: string; from: string; to: string; days: string }>) {
    const pr = next.period ?? periodV;
    const params = new URLSearchParams();
    params.set("period", pr);
    if (pr === "custom") {
      const f = next.from ?? fromD;
      const t = next.to ?? toD;
      if (f) params.set("from", f);
      if (t) params.set("to", t);
    }
    params.set("days", next.days ?? daysV);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
      <FilterSelect
        label="Activity period"
        ariaLabel="Filter by period"
        value={periodV}
        items={PERIOD_LABELS}
        options={PERIOD_OPTIONS}
        onChange={(v) => {
          setPeriodV(v);
          push({ period: v });
        }}
      />
      <FilterSelect
        label="Churn threshold (quiet for)"
        ariaLabel="Churn inactivity threshold"
        value={daysV}
        items={DAYS_LABELS}
        options={DAYS_OPTIONS}
        onChange={(v) => {
          setDaysV(v);
          push({ days: v });
        }}
      />
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
