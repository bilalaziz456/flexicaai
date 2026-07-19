"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { DateRangeFields } from "@/core/ui/date-range-fields";
import {
  FilterSelect,
  PERIOD_OPTIONS,
  PERIOD_LABELS,
} from "@/app/clinic/sales/sales-filters";
import { SearchableSelect } from "@/core/ui/searchable-select";

const BORNE_OPTIONS = [
  { value: "", label: "Any bearer" },
  { value: "clinic", label: "Clinic" },
  { value: "doctor", label: "Doctor" },
  { value: "split", label: "Split" },
];
const BORNE_LABELS = Object.fromEntries(BORNE_OPTIONS.map((o) => [o.value, o.label]));

const STATUS_OPTIONS = [
  { value: "", label: "Any status" },
  { value: "none", label: "Applied" },
  { value: "approved", label: "Approved" },
  { value: "pending", label: "Pending" },
  { value: "rejected", label: "Rejected" },
];
const STATUS_LABELS = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o.label]));

/** Filter bar for the Discounts report: period + custom range, doctor, borne-by, status. */
export function DiscountFilters({
  period,
  from,
  to,
  doctorId,
  borneBy,
  status,
  doctors,
}: {
  period: string;
  from: string;
  to: string;
  doctorId: string;
  borneBy: string;
  status: string;
  doctors: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [periodV, setPeriodV] = useState(period);
  const [fromD, setFromD] = useState(from);
  const [toD, setToD] = useState(to);
  const [doctorV, setDoctorV] = useState(doctorId);
  const [borneV, setBorneV] = useState(borneBy);
  const [statusV, setStatusV] = useState(status);

  function push(next: Partial<{ period: string; from: string; to: string; doctorId: string; borneBy: string; status: string }>) {
    const pr = next.period ?? periodV;
    const f = next.from ?? fromD;
    const t = next.to ?? toD;
    const doc = next.doctorId ?? doctorV;
    const b = next.borneBy ?? borneV;
    const st = next.status ?? statusV;
    const params = new URLSearchParams();
    params.set("period", pr);
    if (pr === "custom") {
      if (f) params.set("from", f);
      if (t) params.set("to", t);
    }
    if (doc) params.set("doctorId", doc);
    if (b) params.set("borneBy", b);
    if (st) params.set("status", st);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const doctorOptions = [
    { value: "", label: "All doctors" },
    ...doctors.map((d) => ({ value: d.id, label: d.name })),
  ];

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
        label="Borne by"
        ariaLabel="Filter by who bears the discount"
        value={borneV}
        items={BORNE_LABELS}
        options={BORNE_OPTIONS}
        onChange={(v) => {
          setBorneV(v);
          push({ borneBy: v });
        }}
      />
      <FilterSelect
        label="Status"
        ariaLabel="Filter by approval status"
        value={statusV}
        items={STATUS_LABELS}
        options={STATUS_OPTIONS}
        onChange={(v) => {
          setStatusV(v);
          push({ status: v });
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
