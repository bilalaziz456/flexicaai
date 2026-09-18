"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { FilterSelect } from "@/core/ui/report-filters";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { DateRangeFields } from "@/core/ui/date-range-fields";
import { PeriodTabs } from "@/core/ui/report-filters";

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

const PAYMENT_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Any payment" },
  { value: "paid", label: "Paid" },
  { value: "partial", label: "Partially paid" },
  { value: "unpaid", label: "Unpaid" },
];

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Any type" },
  { value: "consultation", label: "Consultation" },
  { value: "procedure", label: "Procedure" },
  { value: "both", label: "Both" },
];

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
  calCollapsed = false,
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
  /** Whether the calendar is folded. Carried through for the same reason — a
   *  filter change shouldn't reopen a grid the user chose to close. */
  calCollapsed?: boolean;
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
    if (calCollapsed) params.set("cal", "0");
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
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/70 bg-surface-sunken p-3.5">
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
      <FilterSelect
        label="Status"
        ariaLabel="Filter by status"
        value={statusV}
        options={STATUS_OPTIONS}
        onChange={(v) => {
          setStatusV(v);
          push({ status: v });
        }}
      />

      <FilterSelect
        label="Type"
        ariaLabel="Filter by visit type"
        value={typeV}
        options={TYPE_OPTIONS}
        onChange={(v) => {
          setTypeV(v);
          push({ type: v });
        }}
      />

      {showPayment ? (
        <FilterSelect
          label="Payment"
          ariaLabel="Filter by payment"
          value={paymentV}
          options={PAYMENT_OPTIONS}
          onChange={(v) => {
            setPaymentV(v);
            push({ payment: v });
          }}
        />
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
