"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Checkbox } from "@/core/ui/checkbox";
import { PeriodTabs } from "@/core/ui/report-filters";
import { DateRangeFields } from "@/core/ui/date-range-fields";
import { SearchableSelect } from "@/core/ui/searchable-select";
import { SelectField } from "@/core/ui/select-field";
import { Label } from "@/core/ui/label";
import { INVOICE_STATUS_FILTERS } from "@/core/admin/invoice-status";

// The select cannot hold "" as a value, so "All statuses" travels as "all" here and
// as no `status` param in the URL.
const STATUS_OPTIONS = INVOICE_STATUS_FILTERS.map((o) => ({ value: o.value || "all", label: o.label }));

/** Filter bar for the subscription-invoices ledger — clinic, period, payment status
 *  and a Trash toggle. Pushes the query params the server page reads. */
export function InvoiceFilters({
  period,
  from,
  to,
  clinicId,
  status,
  deleted,
  clinics,
}: {
  period: string;
  from: string;
  to: string;
  clinicId: string;
  /** "" = all. */
  status: string;
  deleted: boolean;
  clinics: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [periodV, setPeriodV] = useState(period);
  const [fromD, setFromD] = useState(from);
  const [toD, setToD] = useState(to);
  const [clinicV, setClinicV] = useState(clinicId);
  const [statusV, setStatusV] = useState(status || "all");

  function push(next: Partial<{ period: string; from: string; to: string; clinicId: string; status: string; deleted: boolean }>) {
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
    const st = next.status ?? statusV;
    if (st && st !== "all") params.set("status", st);
    if (del) params.set("deleted", "1");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const clinicOptions = [{ value: "", label: "All clinics" }, ...clinics.map((c) => ({ value: c.id, label: c.name }))];

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/70 bg-surface-sunken p-3.5">
      <PeriodTabs
        value={periodV}
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
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="inv-status" className="text-xs font-normal text-muted-foreground">Payment</Label>
        <SelectField
          id="inv-status"
          ariaLabel="Filter by payment status"
          value={statusV}
          options={STATUS_OPTIONS}
          onValueChange={(v) => {
            setStatusV(v);
            push({ status: v });
          }}
          className="h-8 w-40"
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
        <Checkbox checked={deleted} onCheckedChange={(next) => push({ deleted: next })} />
        Trash
      </label>
    </div>
  );
}
