"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import {
  FilterSelect,
  filterFieldCls,
  filterLabelCls,
} from "@/core/ui/report-filters";
import { SearchableSelect } from "@/core/ui/searchable-select";

type Opt = { value: string; label: string };

/**
 * Clinics list filter bar — same look as the clinic-panel filters (a bordered
 * bar of labelled Base UI selects + a debounced search). Status + Billing +
 * Account-manager selects; the manager select is only rendered for full-access
 * users (scoped members see just their own clinics).
 */
export function ClinicsFilters({
  q,
  status,
  billing,
  assigned,
  statusOptions,
  showBilling,
  showManager,
  team,
}: {
  q: string;
  status: string;
  billing: string;
  assigned: string;
  statusOptions: Opt[];
  showBilling: boolean;
  showManager: boolean;
  team: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(q);
  const [statusV, setStatusV] = useState(status);
  const [billingV, setBillingV] = useState(billing);
  const [assignedV, setAssignedV] = useState(assigned);

  function push(next: Partial<{ q: string; status: string; billing: string; assigned: string }>) {
    const qq = next.q ?? query;
    const s = next.status ?? statusV;
    const b = next.billing ?? billingV;
    const a = next.assigned ?? assignedV;
    const params = new URLSearchParams();
    if (qq.trim()) params.set("q", qq.trim());
    if (s) params.set("status", s);
    if (b) params.set("billing", b);
    if (a) params.set("assigned", a);
    router.replace(params.toString() ? `${pathname}?${params.toString()}` : pathname, { scroll: false });
  }

  // Debounced text search.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => push({ q: query }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const billingOptions: Opt[] = [
    { value: "", label: "All billing" },
    { value: "due", label: "Due" },
    { value: "overdue", label: "Overdue" },
  ];
  const managerOptions: Opt[] = [
    { value: "", label: "Any manager" },
    { value: "me", label: "My clinics" },
    { value: "unassigned", label: "Unassigned" },
    ...team.map((m) => ({ value: m.id, label: m.name })),
  ];
  const asItems = (o: Opt[]) => Object.fromEntries(o.map((x) => [x.value, x.label]));

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
      <FilterSelect
        label="Status"
        ariaLabel="Filter by status"
        value={statusV}
        items={asItems(statusOptions)}
        options={statusOptions}
        onChange={(v) => {
          setStatusV(v);
          push({ status: v });
        }}
      />
      {showBilling ? (
        <FilterSelect
          label="Billing"
          ariaLabel="Filter by billing"
          value={billingV}
          items={asItems(billingOptions)}
          options={billingOptions}
          onChange={(v) => {
            setBillingV(v);
            push({ billing: v });
          }}
        />
      ) : null}
      {showManager ? (
        <SearchableSelect
          label="Account manager"
          ariaLabel="Filter by account manager"
          value={assignedV}
          options={managerOptions}
          placeholder="Any manager"
          searchPlaceholder="Search team…"
          onChange={(v) => {
            setAssignedV(v);
            push({ assigned: v });
          }}
        />
      ) : null}
      <div className={`${filterFieldCls} min-w-40 flex-1`}>
        <Label htmlFor="cl-q" className={filterLabelCls}>Search</Label>
        <Input
          id="cl-q"
          placeholder="Clinic name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
    </div>
  );
}
