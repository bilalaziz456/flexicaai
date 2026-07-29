"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { DateRangeFields } from "@/core/ui/date-range-fields";
import {
  FilterSelect,
  PeriodTabs,
} from "@/app/clinic/sales/sales-filters";
import { SearchableSelect } from "@/core/ui/searchable-select";

const METHOD_OPTIONS = [
  { value: "", label: "Any method" },
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
];
const METHOD_LABELS = Object.fromEntries(METHOD_OPTIONS.map((o) => [o.value, o.label]));

const KIND_OPTIONS = [
  { value: "", label: "Any type" },
  { value: "payment", label: "Payment" },
  { value: "advance", label: "Advance" },
  { value: "advance_applied", label: "Advance applied" },
  { value: "refund", label: "Refund" },
];
const KIND_LABELS = Object.fromEntries(KIND_OPTIONS.map((o) => [o.value, o.label]));

/** Filter bar for the Payments ledger: period + range, doctor, method, kind, patient search. */
export function PaymentsFilters({
  period,
  from,
  to,
  doctorId,
  method,
  kind,
  q,
  doctors,
}: {
  period: string;
  from: string;
  to: string;
  doctorId: string;
  method: string;
  kind: string;
  q: string;
  doctors: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [periodV, setPeriodV] = useState(period);
  const [fromD, setFromD] = useState(from);
  const [toD, setToD] = useState(to);
  const [doctorV, setDoctorV] = useState(doctorId);
  const [methodV, setMethodV] = useState(method);
  const [kindV, setKindV] = useState(kind);
  const [qV, setQV] = useState(q);

  function push(
    next: Partial<{
      period: string;
      from: string;
      to: string;
      doctorId: string;
      method: string;
      kind: string;
      q: string;
    }>,
  ) {
    const pr = next.period ?? periodV;
    const f = next.from ?? fromD;
    const t = next.to ?? toD;
    const doc = next.doctorId ?? doctorV;
    const m = next.method ?? methodV;
    const k = next.kind ?? kindV;
    const query = next.q ?? qV;
    const params = new URLSearchParams();
    params.set("period", pr);
    if (pr === "custom") {
      if (f) params.set("from", f);
      if (t) params.set("to", t);
    }
    if (doc) params.set("doctorId", doc);
    if (m) params.set("method", m);
    if (k) params.set("kind", k);
    if (query) params.set("q", query);
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
      <FilterSelect
        label="Method"
        ariaLabel="Filter by method"
        value={methodV}
        items={METHOD_LABELS}
        options={METHOD_OPTIONS}
        onChange={(v) => {
          setMethodV(v);
          push({ method: v });
        }}
      />
      <FilterSelect
        label="Type"
        ariaLabel="Filter by payment type"
        value={kindV}
        items={KIND_LABELS}
        options={KIND_OPTIONS}
        onChange={(v) => {
          setKindV(v);
          push({ kind: v });
        }}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor="pay-q" className="text-xs text-muted-foreground">
          Patient
        </label>
        <input
          id="pay-q"
          type="search"
          defaultValue={q}
          placeholder="Name, phone, payment # or MRN"
          onChange={(e) => {
            setQV(e.target.value);
          }}
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
