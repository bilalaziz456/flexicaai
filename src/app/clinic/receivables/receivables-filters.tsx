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
import { SearchableSelect } from "@/core/ui/searchable-select";

// Receivables is a point-in-time balance, so it defaults to ALL TIME (no date
// bound) — the presets narrow it to visits within a window when needed.
const RECV_PERIOD_OPTIONS = [{ value: "all", label: "All time" }, ...PERIOD_OPTIONS];
const RECV_PERIOD_LABELS = Object.fromEntries(RECV_PERIOD_OPTIONS.map((o) => [o.value, o.label]));

const inputCls =
  "h-8 w-56 rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** Filter bar for Receivables: period (default All time) + custom range, doctor, patient search. */
export function ReceivablesFilters({
  period,
  from,
  to,
  doctorId,
  q,
  doctors,
}: {
  period: string;
  from: string;
  to: string;
  doctorId: string;
  q: string;
  doctors: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [periodV, setPeriodV] = useState(period);
  const [fromD, setFromD] = useState(from);
  const [toD, setToD] = useState(to);
  const [doctorV, setDoctorV] = useState(doctorId);
  const [qV, setQV] = useState(q);

  function push(next: Partial<{ period: string; from: string; to: string; doctorId: string; q: string }>) {
    const pr = next.period ?? periodV;
    const f = next.from ?? fromD;
    const t = next.to ?? toD;
    const doc = next.doctorId ?? doctorV;
    const query = next.q ?? qV;
    const params = new URLSearchParams();
    if (pr && pr !== "all") params.set("period", pr);
    if (pr === "custom") {
      if (f) params.set("from", f);
      if (t) params.set("to", t);
    }
    if (doc) params.set("doctorId", doc);
    if (query.trim()) params.set("q", query.trim());
    router.replace(params.toString() ? `${pathname}?${params.toString()}` : pathname, { scroll: false });
  }

  const doctorOptions = [{ value: "", label: "All doctors" }, ...doctors.map((d) => ({ value: d.id, label: d.name }))];

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
      <FilterSelect
        label="Period"
        ariaLabel="Filter by period"
        value={periodV || "all"}
        items={RECV_PERIOD_LABELS}
        options={RECV_PERIOD_OPTIONS}
        onChange={(v) => {
          setPeriodV(v);
          push({ period: v });
        }}
      />
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
      <div className={filterFieldCls}>
        <Label htmlFor="recv-q" className={filterLabelCls}>Patient</Label>
        <input
          id="recv-q"
          type="search"
          value={qV}
          placeholder="Name or phone"
          onChange={(e) => setQV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") push({ q: qV });
          }}
          onBlur={() => push({ q: qV })}
          className={inputCls}
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
