"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Label } from "@/core/ui/label";
import { DateRangeFields } from "@/core/ui/date-range-fields";
import {
  FilterSelect,
  PERIOD_OPTIONS,
  filterFieldCls,
  filterLabelCls,
} from "@/app/clinic/sales/sales-filters";

// The register defaults to ALL TIME (no date bound); presets narrow by issued date.
const INV_PERIOD_OPTIONS = [{ value: "all", label: "All time" }, ...PERIOD_OPTIONS];
const INV_PERIOD_LABELS = Object.fromEntries(INV_PERIOD_OPTIONS.map((o) => [o.value, o.label]));

const inputCls =
  "h-8 w-56 rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** Filter bar for the Invoices register: period (default All time) + range, search. */
export function InvoiceFilters({
  period,
  from,
  to,
  q,
}: {
  period: string;
  from: string;
  to: string;
  q: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [periodV, setPeriodV] = useState(period);
  const [fromD, setFromD] = useState(from);
  const [toD, setToD] = useState(to);
  const [qV, setQV] = useState(q);

  function push(next: Partial<{ period: string; from: string; to: string; q: string }>) {
    const pr = next.period ?? periodV;
    const f = next.from ?? fromD;
    const t = next.to ?? toD;
    const query = next.q ?? qV;
    const params = new URLSearchParams();
    if (pr && pr !== "all") params.set("period", pr);
    if (pr === "custom") {
      if (f) params.set("from", f);
      if (t) params.set("to", t);
    }
    if (query.trim()) params.set("q", query.trim());
    router.replace(params.toString() ? `${pathname}?${params.toString()}` : pathname, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
      <FilterSelect
        label="Period"
        ariaLabel="Filter by period"
        value={periodV || "all"}
        items={INV_PERIOD_LABELS}
        options={INV_PERIOD_OPTIONS}
        onChange={(v) => {
          setPeriodV(v);
          push({ period: v });
        }}
      />
      <div className={filterFieldCls}>
        <Label htmlFor="inv-q" className={filterLabelCls}>Search</Label>
        <input
          id="inv-q"
          type="search"
          value={qV}
          placeholder="Invoice no. or patient"
          onChange={(e) => setQV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") push({ q: qV });
          }}
          onBlur={() => push({ q: qV })}
          className={inputCls}
        />
      </div>
      <DateRangeFields
        idPrefix="inv-"
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
