"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Select } from "@base-ui/react/select";
import { Check, ChevronsUpDown } from "lucide-react";
import { Label } from "@/core/ui/label";
import { DateRangeFields } from "@/core/ui/date-range-fields";

type Option = { value: string; label: string };

/** Themed single-select (Base UI) — accent hover, no system blue. */
function FilterSelect({
  ariaLabel,
  value,
  options,
  onChange,
  width = "w-48",
  disabled = false,
  placeholder,
}: {
  ariaLabel: string;
  value: string;
  options: Option[];
  onChange: (v: string) => void;
  width?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const items: Record<string, string> = Object.fromEntries(
    options.map((o) => [o.value, o.label]),
  );
  if (disabled) {
    // e.g. the employee filter before a clinic is chosen — a non-interactive
    // trigger showing the hint, so the dependency is obvious.
    return (
      <div
        aria-label={ariaLabel}
        aria-disabled="true"
        className={`inline-flex h-8 ${width} cursor-not-allowed items-center justify-between gap-1.5 rounded-lg border border-input bg-[var(--input-bg)] pl-2.5 pr-3.5 text-sm text-muted-foreground opacity-70`}
      >
        <span className="truncate">{placeholder ?? "—"}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
      </div>
    );
  }
  return (
    <Select.Root
      items={items}
      value={value}
      onValueChange={(next) => onChange((next as string | null) ?? "")}
    >
      <Select.Trigger
        aria-label={ariaLabel}
        className={`inline-flex h-8 ${width} items-center justify-between gap-1.5 rounded-lg border border-input bg-[var(--input-bg)] pl-2.5 pr-3.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:border-ring`}
      >
        <Select.Value />
        <Select.Icon>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
          <Select.Popup className="z-50 max-h-72 min-w-48 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
            {options.map((o) => (
              <Select.Item
                key={o.value}
                value={o.value}
                className="flex cursor-default select-none items-center gap-2 rounded-md py-1.5 pl-2 pr-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                <span className="flex w-4 shrink-0 items-center justify-center">
                  <Select.ItemIndicator>
                    <Check className="size-3.5" aria-hidden="true" />
                  </Select.ItemIndicator>
                </span>
                <Select.ItemText>{o.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

/**
 * Activity-log filter bar (clinic + admin). Date range defaults to today; the
 * employee dropdown narrows to one actor; the optional clinic dropdown (passed
 * only for the super admin) narrows to one clinic. Route-agnostic — pushes
 * `from`/`to`/`actor`/`clinic` query params the server page reads.
 */
export function LogFilters({
  from,
  to,
  today,
  actor,
  actors,
  clinic,
  clinics,
  action,
  actionOptions,
}: {
  from: string;
  to: string;
  today: string;
  /** Selected employee = a user id. */
  actor: string;
  /** Employee options — the clinic's staff (id + display name). */
  actors: { id: string; name: string }[];
  /** Selected clinic id (super admin only). */
  clinic?: string;
  /** Clinic options (super admin only). When omitted, no clinic filter shows. */
  clinics?: { id: string; name: string }[];
  /** Selected action category (empty = all). */
  action: string;
  /** Action-category options the viewer may filter by (clinic: only granted). */
  actionOptions: Option[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [fromD, setFromD] = useState(from);
  const [toD, setToD] = useState(to);
  const [actorV, setActorV] = useState(actor);
  const [clinicV, setClinicV] = useState(clinic ?? "");
  const [actionV, setActionV] = useState(action);

  function push(next: {
    from?: string;
    to?: string;
    actor?: string;
    clinic?: string;
    action?: string;
  }) {
    const f = next.from ?? fromD;
    const t = next.to ?? toD;
    const a = next.actor ?? actorV;
    const c = next.clinic ?? clinicV;
    const act = next.action ?? actionV;
    const params = new URLSearchParams();
    if (f) params.set("from", f);
    if (t) params.set("to", t);
    if (a) params.set("actor", a);
    if (c) params.set("clinic", c);
    if (act) params.set("action", act);
    const s = params.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }

  // One consistent field wrapper (label above control) so every filter — and the
  // Today button — has the exact same height and bottom-aligns cleanly.
  const fieldCls = "flex flex-col gap-1.5";
  const labelCls = "text-xs font-normal text-muted-foreground";

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
      <DateRangeFields
        from={fromD}
        to={toD}
        onFrom={(v) => {
          setFromD(v);
          push({ from: v });
        }}
        onTo={(v) => {
          setToD(v);
          push({ to: v });
        }}
      />

      {clinics ? (
        <div className={fieldCls}>
          <Label className={labelCls}>Clinic</Label>
          <FilterSelect
            ariaLabel="Filter by clinic"
            width="w-44"
            value={clinicV}
            onChange={(v) => {
              setClinicV(v);
              // Changing clinic clears the actor (actor lists are per-clinic).
              setActorV("");
              push({ clinic: v, actor: "" });
            }}
            options={[
              { value: "", label: "All clinics" },
              ...clinics.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>
      ) : null}

      <div className={fieldCls}>
        <Label className={labelCls}>Employee</Label>
        <FilterSelect
          ariaLabel="Filter by employee"
          width="w-44"
          value={actorV}
          // Super admin (clinics provided) must pick a clinic first; then the
          // employee list is that clinic's staff.
          disabled={Boolean(clinics) && !clinicV}
          placeholder="Select a clinic first"
          onChange={(v) => {
            setActorV(v);
            push({ actor: v });
          }}
          options={[
            { value: "", label: "All employees" },
            ...actors.map((a) => ({ value: a.id, label: a.name })),
          ]}
        />
      </div>

      <div className={fieldCls}>
        <Label className={labelCls}>Action</Label>
        <FilterSelect
          ariaLabel="Filter by action"
          width="w-44"
          value={actionV}
          onChange={(v) => {
            setActionV(v);
            push({ action: v });
          }}
          options={[{ value: "", label: "All actions" }, ...actionOptions]}
        />
      </div>

      <div className={fieldCls}>
        {/* Invisible label (real Label element) keeps this column the same height
            as the others, so the button aligns with the inputs. */}
        <Label className={`${labelCls} invisible`} aria-hidden="true">
          Today
        </Label>
        <button
          type="button"
          onClick={() => {
            setFromD(today);
            setToD(today);
            push({ from: today, to: today });
          }}
          className="h-8 rounded-lg border border-input bg-[var(--input-bg)] px-4 text-sm font-medium outline-none transition-colors hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Today
        </button>
      </div>
    </div>
  );
}
