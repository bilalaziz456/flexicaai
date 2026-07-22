"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  FilterSelect,
  PERIOD_LABELS,
  PERIOD_OPTIONS,
} from "@/app/clinic/sales/sales-filters";
import { DateRangeFields } from "@/core/ui/date-range-fields";
import { SearchableSelect } from "@/core/ui/searchable-select";

/** Filter bar for the subscription-invoices ledger — clinic, period, and a Trash
 *  toggle. Pushes the query params the server page reads. */
export function InvoiceFilters({
  period,
  from,
  to,
  clinicId,
  deleted,
  clinics,
}: {
  period: string;
  from: string;
  to: string;
  clinicId: string;
  deleted: boolean;
  clinics: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [periodV, setPeriodV] = useState(period);
  const [fromD, setFromD] = useState(from);
  const [toD, setToD] = useState(to);
  const [clinicV, setClinicV] = useState(clinicId);

  function push(next: Partial<{ period: string; from: string; to: string; clinicId: string; deleted: boolean }>) {
    const pr = next.period ?? periodV;
    const params = new URLSearchParams();
    params.set("period", pr);
    if (pr === "custom") {
      const f = next.from ?? fromD;
      const t = next.to ?? toD;
      if (f) params.set("from", f);
      if (t) params.set("to", t);
    }
    const c = next.clinicId ?? clinicV;
    const del = next.deleted ?? deleted;
    if (c) params.set("clinicId", c);
    if (del) params.set("deleted", "1");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const clinicOptions = [{ value: "", label: "All clinics" }, ...clinics.map((c) => ({ value: c.id, label: c.name }))];

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
      <SearchableSelect
        label="Clinic"
        ariaLabel="Filter by clinic"
        value={clinicV}
        options={clinicOptions}
        placeholder="All clinics"
        searchPlaceholder="Search clinics…"
        onChange={(v) => {
          setClinicV(v);
          push({ clinicId: v });
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
      <label className="flex items-center gap-2 pb-1.5 text-sm">
        <input type="checkbox" checked={deleted} onChange={(e) => push({ deleted: e.target.checked })} className="size-4 accent-[var(--color-primary)]" />
        Trash
      </label>
    </div>
  );
}
