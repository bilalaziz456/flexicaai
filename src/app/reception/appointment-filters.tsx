"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Select } from "@base-ui/react/select";
import { Check, ChevronsUpDown } from "lucide-react";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { DateRangeFields } from "@/core/ui/date-range-fields";
import { PeriodTabs } from "@/app/clinic/sales/sales-filters";

type ApptDir = "upcoming" | "past";
// Direction toggle: the same period pills window FORWARD (the schedule ahead) or
// BACKWARD (review the past). Reused as a PeriodTabs group.
const APPT_DIRECTIONS = [
  { value: "upcoming", label: "Upcoming", title: "Appointments from today onward" },
  { value: "past", label: "Past", title: "Past appointments up to today" },
];
// Appointment period pills — each maps to a from/to the list already understands; the
// direction toggle decides whether they extend forward or backward from today.
const APPT_PERIOD_PRESETS = [
  { value: "today", label: "Today", title: "Today" },
  { value: "7d", label: "7d", title: "7 days" },
  { value: "15d", label: "15d", title: "15 days" },
  { value: "30d", label: "30d", title: "30 days" },
  { value: "quarter", label: "Quarter", title: "90 days" },
  { value: "half", label: "6mo", title: "180 days" },
  { value: "year", label: "Year", title: "365 days" },
];
const APPT_PERIOD_DAYS: Record<string, number> = {
  today: 1, "7d": 7, "15d": 15, "30d": 30, quarter: 90, half: 180, year: 365,
};
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** An inclusive N-day window from `today`, forward (upcoming) or backward (past). */
function apptWindow(period: string, today: string, dir: ApptDir): { from: string; to: string } {
  const [y, m, d] = today.split("-").map(Number);
  const span = (APPT_PERIOD_DAYS[period] ?? 1) - 1;
  const edge = new Date(y, m - 1, d);
  edge.setDate(edge.getDate() + (dir === "past" ? -span : span));
  return dir === "past" ? { from: ymd(edge), to: today } : { from: today, to: ymd(edge) };
}
/** Infer the toggle direction from an incoming range (a range ending today = past). */
function dirFromRange(from: string, to: string, today: string): ApptDir {
  return to === today && from !== today ? "past" : "upcoming";
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "scheduled", label: "Scheduled" },
  { value: "confirmed", label: "Confirmed" },
  { value: "arrived", label: "Arrived" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "no_show", label: "No-show" },
];
const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  STATUS_OPTIONS.map((o) => [o.value, o.label]),
);

const PAYMENT_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Any payment" },
  { value: "paid", label: "Paid" },
  { value: "partial", label: "Partially paid" },
  { value: "unpaid", label: "Unpaid" },
];
const PAYMENT_LABELS: Record<string, string> = Object.fromEntries(
  PAYMENT_OPTIONS.map((o) => [o.value, o.label]),
);

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Any type" },
  { value: "consultation", label: "Consultation" },
  { value: "procedure", label: "Procedure" },
  { value: "both", label: "Both" },
];
const TYPE_LABELS: Record<string, string> = Object.fromEntries(
  TYPE_OPTIONS.map((o) => [o.value, o.label]),
);

/**
 * Date-range + text filter bar for the appointment lists (clinic + reception).
 * Route-agnostic (uses the current pathname). Pushes `from`/`to`/`q` query
 * params; the server page reads them and filters. Search is debounced; date
 * changes apply immediately. A "Today" button resets the range to today.
 */
export function AppointmentFilters({
  from,
  to,
  q,
  status,
  type = "",
  payment = "",
  showPayment = false,
  today,
  session = "",
  month = "",
}: {
  from: string;
  to: string;
  q: string;
  status: string;
  type?: string;
  payment?: string;
  /** Show the Payment (Paid/Partial/Unpaid) filter — only when the clinic bills. */
  showPayment?: boolean;
  today: string;
  /** When set, the list is scoped to one doctor's queue: preserve it on every
   *  filter change and hide the date range (the session already pins the day). */
  session?: string;
  /** "YYYY-MM" the calendar is browsing. Carried through so changing a filter
   *  doesn't snap the grid back to the month of the date range. */
  month?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [fromD, setFromD] = useState(from);
  const [toD, setToD] = useState(to);
  const [direction, setDirection] = useState<ApptDir>(dirFromRange(from, to, today));
  const [query, setQuery] = useState(q);
  const [statusV, setStatusV] = useState(status);
  const [typeV, setTypeV] = useState(type);
  const [paymentV, setPaymentV] = useState(payment);

  function push(next: {
    from?: string;
    to?: string;
    q?: string;
    status?: string;
    type?: string;
    payment?: string;
  }) {
    const f = next.from ?? fromD;
    const t = next.to ?? toD;
    const qq = next.q ?? query;
    const st = next.status ?? statusV;
    const ty = next.type ?? typeV;
    const pay = next.payment ?? paymentV;
    const params = new URLSearchParams();
    // In a queue view the session pins the doctor/day — keep it and drop the date
    // range; otherwise carry the date range as usual.
    if (session) {
      params.set("session", session);
    } else {
      if (f) params.set("from", f);
      if (t) params.set("to", t);
    }
    if (qq.trim()) params.set("q", qq.trim());
    if (st) params.set("status", st);
    if (ty) params.set("type", ty);
    if (pay) params.set("payment", pay);
    if (month) params.set("month", month);
    const s = params.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }

  // Debounce the search box; skip the initial mount so we don't navigate on load.
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

  // Which period pill is lit: the range matches one of the windows in the current
  // direction. A hand-edited range matches none (custom).
  const activePeriod =
    APPT_PERIOD_PRESETS.find((p) => {
      const w = apptWindow(p.value, today, direction);
      return w.from === fromD && w.to === toD;
    })?.value ?? "";

  const pickPeriod = (v: string) => {
    const w = apptWindow(v, today, direction);
    setFromD(w.from);
    setToD(w.to);
    push({ from: w.from, to: w.to });
  };

  // Flip Upcoming↔Past: re-apply the active preset in the new direction so the list
  // updates immediately (a custom range just changes what the next pill click means).
  const switchDirection = (dir: ApptDir) => {
    setDirection(dir);
    if (activePeriod) {
      const w = apptWindow(activePeriod, today, dir);
      setFromD(w.from);
      setToD(w.to);
      push({ from: w.from, to: w.to });
    }
  };

  // One consistent field wrapper (label above control), matching the log filter
  // bar, so every control — and the Today button — bottom-aligns cleanly.
  const fieldCls = "flex flex-col gap-1.5";
  const labelCls = "text-xs font-normal text-muted-foreground";

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
      {!session ? (
        <PeriodTabs
          label="Direction"
          presets={APPT_DIRECTIONS}
          value={direction}
          onChange={(v) => switchDirection(v as ApptDir)}
        />
      ) : null}
      {!session ? (
        <PeriodTabs presets={APPT_PERIOD_PRESETS} value={activePeriod} onChange={pickPeriod} />
      ) : null}
      {!session ? (
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
      ) : null}
      <div className={fieldCls}>
        <Label className={labelCls}>Status</Label>
        <Select.Root
          items={STATUS_LABELS}
          value={statusV}
          onValueChange={(next) => {
            const v = (next as string | null) ?? "";
            setStatusV(v);
            push({ status: v });
          }}
        >
          <Select.Trigger
            aria-label="Filter by status"
            className="inline-flex h-8 w-44 items-center justify-between gap-1.5 rounded-lg border border-input bg-[var(--input-bg)] pl-2.5 pr-3.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:border-ring"
          >
            <Select.Value />
            <Select.Icon>
              <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
              <Select.Popup className="z-50 min-w-40 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
                {STATUS_OPTIONS.map((o) => (
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
      </div>

      <div className={fieldCls}>
        <Label className={labelCls}>Type</Label>
        <Select.Root
          items={TYPE_LABELS}
          value={typeV}
          onValueChange={(next) => {
            const v = (next as string | null) ?? "";
            setTypeV(v);
            push({ type: v });
          }}
        >
          <Select.Trigger
            aria-label="Filter by visit type"
            className="inline-flex h-8 w-44 items-center justify-between gap-1.5 rounded-lg border border-input bg-[var(--input-bg)] pl-2.5 pr-3.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:border-ring"
          >
            <Select.Value />
            <Select.Icon>
              <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
              <Select.Popup className="z-50 min-w-40 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
                {TYPE_OPTIONS.map((o) => (
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
      </div>

      {showPayment ? (
        <div className={fieldCls}>
          <Label className={labelCls}>Payment</Label>
          <Select.Root
            items={PAYMENT_LABELS}
            value={paymentV}
            onValueChange={(next) => {
              const v = (next as string | null) ?? "";
              setPaymentV(v);
              push({ payment: v });
            }}
          >
            <Select.Trigger
              aria-label="Filter by payment"
              className="inline-flex h-8 w-44 items-center justify-between gap-1.5 rounded-lg border border-input bg-[var(--input-bg)] pl-2.5 pr-3.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:border-ring"
            >
              <Select.Value />
              <Select.Icon>
                <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
              </Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
                <Select.Popup className="z-50 min-w-40 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
                  {PAYMENT_OPTIONS.map((o) => (
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
        </div>
      ) : null}

      <div className={`${fieldCls} min-w-40 flex-1`}>
        <Label htmlFor="q" className={labelCls}>
          Search
        </Label>
        <Input
          id="q"
          placeholder="Search patient name or phone…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
    </div>
  );
}
