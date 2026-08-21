"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  FilterSelect,
  PeriodTabs,
  filterFieldCls,
  filterLabelCls,
} from "@/core/ui/report-filters";
import { DateRangeFields } from "@/core/ui/date-range-fields";
import { Label } from "@/core/ui/label";
import { Input } from "@/core/ui/input";

const METHOD_OPTIONS = [
  { value: "", label: "All methods" },
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
];
const METHOD_LABELS = Object.fromEntries(METHOD_OPTIONS.map((o) => [o.value, o.label]));

/** Filter bar for the company expenses ledger — period, category, method, search
 *  and a Trash toggle. Pushes the query params the server page reads. */
export function ExpensesFilters({
  period,
  from,
  to,
  categoryId,
  method,
  q,
  deleted,
  categories,
}: {
  period: string;
  from: string;
  to: string;
  categoryId: string;
  method: string;
  q: string;
  deleted: boolean;
  categories: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [periodV, setPeriodV] = useState(period);
  const [fromD, setFromD] = useState(from);
  const [toD, setToD] = useState(to);
  const [catV, setCatV] = useState(categoryId);
  const [methodV, setMethodV] = useState(method);
  const [qV, setQV] = useState(q);
  const first = useRef(true);

  function push(next: Partial<{ period: string; from: string; to: string; categoryId: string; method: string; q: string; deleted: boolean }>) {
    const pr = next.period ?? periodV;
    const params = new URLSearchParams();
    params.set("period", pr);
    if (pr === "custom") {
      const f = next.from ?? fromD;
      const t = next.to ?? toD;
      if (f) params.set("from", f);
      if (t) params.set("to", t);
    }
    const cat = next.categoryId ?? catV;
    const m = next.method ?? methodV;
    const query = next.q ?? qV;
    const del = next.deleted ?? deleted;
    if (cat) params.set("categoryId", cat);
    if (m) params.set("method", m);
    if (query) params.set("q", query.trim());
    if (del) params.set("deleted", "1");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  // Debounce the search box.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = setTimeout(() => push({ q: qV }), 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qV]);

  const categoryOptions = [{ value: "", label: "All categories" }, ...categories.map((c) => ({ value: c.id, label: c.name }))];
  const categoryLabels = Object.fromEntries(categoryOptions.map((o) => [o.value, o.label]));

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
      <PeriodTabs
        value={periodV}
        onChange={(v) => {
          setPeriodV(v);
          push({ period: v });
        }}
      />
      <FilterSelect
        label="Category"
        ariaLabel="Filter by category"
        value={catV}
        items={categoryLabels}
        options={categoryOptions}
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
        <Label className={filterLabelCls}>Search</Label>
        <Input
          value={qV}
          onChange={(e) => setQV(e.target.value)}
          placeholder="Vendor or note…"
          className="h-8 w-44"
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
      <label className="flex items-center gap-2 pb-1.5 text-sm">
        <input
          type="checkbox"
          checked={deleted}
          onChange={(e) => push({ deleted: e.target.checked })}
          className="size-4 accent-[var(--color-primary)]"
        />
        Trash
      </label>
    </div>
  );
}
