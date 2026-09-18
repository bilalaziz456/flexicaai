"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { FilterSelect, filterFieldCls, filterLabelCls } from "@/core/ui/report-filters";
import { SearchableSelect } from "@/core/ui/searchable-select";
import { DateRangeFields } from "@/core/ui/date-range-fields";

type Opt = { value: string; label: string };

/**
 * Announcements filter bar — the same bordered row of selects plus a debounced search
 * the clinics list uses, so the two admin lists behave identically.
 *
 * "State" is deliberately not the `active` flag. Active only means "not switched off",
 * and the questions actually asked here are "what is on screen right now" and "what is
 * queued for later" — which a flag alone cannot answer.
 */
export function AnnouncementFilters({
  q,
  state,
  level,
  clinic,
  audience,
  from,
  to,
  clinics,
  levelOptions,
  roleOptions,
}: {
  q: string;
  state: string;
  level: string;
  clinic: string;
  audience: string;
  from: string;
  to: string;
  clinics: { id: string; name: string }[];
  levelOptions: Opt[];
  roleOptions: Opt[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(q);
  const [stateV, setStateV] = useState(state);
  const [levelV, setLevelV] = useState(level);
  const [clinicV, setClinicV] = useState(clinic);
  const [audienceV, setAudienceV] = useState(audience);
  const [fromV, setFromV] = useState(from);
  const [toV, setToV] = useState(to);

  function push(
    next: Partial<{ q: string; state: string; level: string; clinic: string; audience: string; from: string; to: string }>,
  ) {
    const params = new URLSearchParams();
    const qq = (next.q ?? query).trim();
    const s = next.state ?? stateV;
    const l = next.level ?? levelV;
    const c = next.clinic ?? clinicV;
    const a = next.audience ?? audienceV;
    const f = next.from ?? fromV;
    const t = next.to ?? toV;
    if (qq) params.set("q", qq);
    if (s) params.set("state", s);
    if (l) params.set("level", l);
    if (c) params.set("clinic", c);
    if (a) params.set("audience", a);
    if (f) params.set("from", f);
    if (t) params.set("to", t);
    // No `page`: changing a filter must land on page 1, or a narrower filter leaves you
    // on a page that no longer exists and the list reads as empty.
    router.replace(params.toString() ? `${pathname}?${params.toString()}` : pathname, { scroll: false });
  }

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

  const stateOptions: Opt[] = [
    { value: "", label: "Any state" },
    { value: "showing", label: "Showing now" },
    { value: "scheduled", label: "Scheduled" },
    { value: "ended", label: "Ended" },
    { value: "inactive", label: "Deactivated" },
  ];
  const clinicOptions: Opt[] = [
    { value: "", label: "Any clinic" },
    { value: "broadcast", label: "All-clinic posts" },
    ...clinics.map((c) => ({ value: c.id, label: c.name })),
  ];
  const audienceOptions: Opt[] = [
    { value: "", label: "Any audience" },
    ...roleOptions.map((r) => ({ value: r.value, label: `${r.label} only` })),
  ];
  const asItems = (o: Opt[]) => Object.fromEntries(o.map((x) => [x.value, x.label]));

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/70 bg-surface-sunken p-3.5">
      {/* Matches posts whose display WINDOW overlaps the range — "what was showing in
          September" — not merely those posted in it. */}
      <DateRangeFields
        idPrefix="ann-"
        from={fromV}
        to={toV}
        onFrom={(v) => {
          setFromV(v);
          push({ from: v });
        }}
        onTo={(v) => {
          setToV(v);
          push({ to: v });
        }}
      />
      <FilterSelect
        label="State"
        ariaLabel="Filter by state"
        value={stateV}
        items={asItems(stateOptions)}
        options={stateOptions}
        onChange={(v) => {
          setStateV(v);
          push({ state: v });
        }}
      />
      <FilterSelect
        label="Level"
        ariaLabel="Filter by level"
        value={levelV}
        items={asItems(levelOptions)}
        options={levelOptions}
        onChange={(v) => {
          setLevelV(v);
          push({ level: v });
        }}
      />
      <SearchableSelect
        label="Clinic"
        ariaLabel="Filter by clinic"
        value={clinicV}
        options={clinicOptions}
        placeholder="Any clinic"
        searchPlaceholder="Search clinics…"
        onChange={(v) => {
          setClinicV(v);
          push({ clinic: v });
        }}
      />
      <FilterSelect
        label="Audience"
        ariaLabel="Filter by audience"
        value={audienceV}
        items={asItems(audienceOptions)}
        options={audienceOptions}
        onChange={(v) => {
          setAudienceV(v);
          push({ audience: v });
        }}
      />
      <div className={`${filterFieldCls} min-w-40 flex-1`}>
        <Label htmlFor="ann-q" className={filterLabelCls}>Search</Label>
        <Input
          id="ann-q"
          placeholder="Title or message…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
    </div>
  );
}
