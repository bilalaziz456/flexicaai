"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { DatePicker } from "@/core/ui/date-picker";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import {
  FilterSelect,
  PERIOD_OPTIONS,
  PERIOD_LABELS,
  filterFieldCls,
  filterLabelCls,
} from "@/app/clinic/sales/sales-filters";

const METHOD_OPTIONS = [
  { value: "", label: "Any method" },
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
];
const METHOD_LABELS = Object.fromEntries(METHOD_OPTIONS.map((o) => [o.value, o.label]));

/** Filter bar for Expenses: period + custom range, category, method, text search. */
export function ExpenseFilters({
  period,
  from,
  to,
  categoryId,
  method,
  q,
  categories,
}: {
  period: string;
  from: string;
  to: string;
  categoryId: string;
  method: string;
  q: string;
  categories: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [periodV, setPeriodV] = useState(period);
  const [fromD, setFromD] = useState(from);
  const [toD, setToD] = useState(to);
  const [catV, setCatV] = useState(categoryId);
  const [methodV, setMethodV] = useState(method);
  const [query, setQuery] = useState(q);

  function push(next: Partial<{ period: string; from: string; to: string; categoryId: string; method: string; q: string }>) {
    const pr = next.period ?? periodV;
    const f = next.from ?? fromD;
    const t = next.to ?? toD;
    const cat = next.categoryId ?? catV;
    const m = next.method ?? methodV;
    const qq = next.q ?? query;
    const params = new URLSearchParams();
    params.set("period", pr);
    if (pr === "custom") {
      if (f) params.set("from", f);
      if (t) params.set("to", t);
    }
    if (cat) params.set("categoryId", cat);
    if (m) params.set("method", m);
    if (qq.trim()) params.set("q", qq.trim());
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => push({ q: query }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const catOptions = [
    { value: "", label: "All categories" },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ];
  const catItems = Object.fromEntries(catOptions.map((o) => [o.value, o.label]));

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
      <FilterSelect
        label="Category"
        ariaLabel="Filter by category"
        value={catV}
        items={catItems}
        options={catOptions}
        onChange={(v) => {
          setCatV(v);
          push({ categoryId: v });
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
      <div className={filterFieldCls}>
        <Label htmlFor="ex-from" className={filterLabelCls}>From</Label>
        <div className="w-44">
          <DatePicker
            id="ex-from"
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
      <div className={filterFieldCls}>
        <Label htmlFor="ex-to" className={filterLabelCls}>To</Label>
        <div className="w-44">
          <DatePicker
            id="ex-to"
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
      <div className={`${filterFieldCls} min-w-40 flex-1`}>
        <Label htmlFor="ex-q" className={filterLabelCls}>Search</Label>
        <Input id="ex-q" placeholder="Vendor or note…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
    </div>
  );
}
