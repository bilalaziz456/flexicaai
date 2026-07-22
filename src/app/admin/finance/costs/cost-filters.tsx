"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  FilterSelect,
  PERIOD_LABELS,
  PERIOD_OPTIONS,
} from "@/app/clinic/sales/sales-filters";
import { DateRangeFields } from "@/core/ui/date-range-fields";

/**
 * Period filter for the company serving-cost page — a preset (this month → last
 * year) or a custom from/to range. Mirrors the Sales report filter bar (same
 * `resolveSalesRange` presets), pushing the query params the server page reads.
 */
export function CostFilters({ period, from, to }: { period: string; from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [periodV, setPeriodV] = useState(period);
  const [fromD, setFromD] = useState(from);
  const [toD, setToD] = useState(to);

  function push(next: { period?: string; from?: string; to?: string }) {
    const pr = next.period ?? periodV;
    const f = next.from ?? fromD;
    const t = next.to ?? toD;
    const params = new URLSearchParams();
    params.set("period", pr);
    if (pr === "custom") {
      if (f) params.set("from", f);
      if (t) params.set("to", t);
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

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
