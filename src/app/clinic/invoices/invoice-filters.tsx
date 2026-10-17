"use client";

import { VISIT_PAYMENT_STATUSES, VISIT_PAYMENT_STATUS_LABEL } from "@/core/billing/payment-status";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Label } from "@/core/ui/label";
import { DateRangeFields } from "@/core/ui/date-range-fields";
import {
  FilterSelect,
  PeriodTabs,
  filterFieldCls,
  filterLabelCls,
} from "@/core/ui/report-filters";

// The register defaults to ALL TIME (no date bound); presets narrow by issued date.
const inputCls =
  "h-8 w-56 rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

// The six payment badges (core/billing/payment-status.ts), plus "any".
const STATE_OPTIONS = [
  { value: "", label: "All invoices" },
  { value: "active", label: "Active" },
  { value: "deleted", label: "Deleted" },
  { value: "void", label: "Void (visit cancelled)" },
];

const PAYMENT_OPTIONS = [
  { value: "", label: "Any payment" },
  ...VISIT_PAYMENT_STATUSES.map((s) => ({ value: s, label: VISIT_PAYMENT_STATUS_LABEL[s] })),
];

/** Filter bar for the Invoices register: period (default All time) + range, status, payment,
 *  what the invoice is for (a procedure or service), search. */
export function InvoiceFilters({
  period,
  from,
  to,
  q,
  payment,
  state,
  procedure,
  forOptions,
}: {
  period: string;
  from: string;
  to: string;
  q: string;
  payment: string;
  state: string;
  /** The "For" filter: a procedure or service id ("" = any). */
  procedure: string;
  forOptions: { value: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [periodV, setPeriodV] = useState(period);
  const [fromD, setFromD] = useState(from);
  const [toD, setToD] = useState(to);
  const [qV, setQV] = useState(q);
  const [payV, setPayV] = useState(payment);
  const [stateV, setStateV] = useState(state);
  const [procV, setProcV] = useState(procedure);

  function push(
    next: Partial<{ period: string; from: string; to: string; q: string; payment: string; state: string; procedure: string }>,
  ) {
    const pr = next.period ?? periodV;
    const f = next.from ?? fromD;
    const t = next.to ?? toD;
    const query = next.q ?? qV;
    const pay = next.payment ?? payV;
    const st = next.state ?? stateV;
    const proc = next.procedure ?? procV;
    const params = new URLSearchParams();
    if (pr && pr !== "all") params.set("period", pr);
    if (pr === "custom") {
      if (f) params.set("from", f);
      if (t) params.set("to", t);
    }
    if (query.trim()) params.set("q", query.trim());
    if (pay) params.set("payment", pay);
    if (st) params.set("state", st);
    if (proc) params.set("procedure", proc);
    router.replace(params.toString() ? `${pathname}?${params.toString()}` : pathname, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/70 bg-surface-sunken p-3.5">
      <PeriodTabs
        value={periodV || "all"}
        onChange={(v) => {
          setPeriodV(v);
          push({ period: v });
        }}
      />
      <FilterSelect
        label="Status"
        ariaLabel="Filter by invoice status"
        value={stateV}
        options={STATE_OPTIONS}
        onChange={(v) => {
          setStateV(v);
          push({ state: v });
        }}
      />
      <FilterSelect
        label="Payment"
        ariaLabel="Filter by payment status"
        value={payV}
        options={PAYMENT_OPTIONS}
        onChange={(v) => {
          setPayV(v);
          push({ payment: v });
        }}
      />
      {forOptions.length > 0 ? (
        <FilterSelect
          label="For"
          ariaLabel="Filter by procedure or service"
          value={procV}
          options={[{ value: "", label: "Any procedure or service" }, ...forOptions]}
          onChange={(v) => {
            setProcV(v);
            push({ procedure: v });
          }}
        />
      ) : null}
      <div className={filterFieldCls}>
        <Label htmlFor="inv-q" className={filterLabelCls}>Search</Label>
        <input
          id="inv-q"
          type="search"
          value={qV}
          placeholder="Invoice #, patient, phone, MRN or patient no."
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
