"use client";

import { BellRing, CalendarCheck2, Check, MessageCircle, ShieldCheck } from "lucide-react";
import { useRef, type CSSProperties } from "react";
import { useOnScreen } from "../story/webgl";
import { cx } from "../ui";

/**
 * Appointment management, in detail: each doctor's week (hours, leave, days off and the
 * daily cap, with today's bookings against it), and recalls moving from due, to sent on
 * WhatsApp, to booked. Animates in when it scrolls into view; still for reduced motion.
 * Invented sample data.
 */

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TODAY = 3; // Thu
const DOCS = [
  { n: "Dr. Sana Malik", i: "SM", hours: ["10–6", "10–6", "10–6", "10–6", "10–6", "10–2"], cap: 16, today: 11 },
  { n: "Dr. Omar Rafiq", i: "OR", hours: ["2–8", "2–8", "Leave", "2–8", "2–8", "—"], cap: 12, today: 7 },
  { n: "Dr. Hira Aslam", i: "HA", hours: ["—", "11–5", "11–5", "—", "11–5", "11–5"], cap: 10, today: 0 },
];

const STAGES = [
  { k: "Due", icon: BellRing },
  { k: "Sent on WhatsApp", icon: MessageCircle },
  { k: "Booked", icon: CalendarCheck2 },
];
const RECALLS = [
  { n: "Usman Tariq", i: "UT", r: "6-month check-up", stage: 0 },
  { n: "Hina Raza", i: "HR", r: "Blood pressure review", stage: 1 },
  { n: "Bilal Ahmed", i: "BA", r: "Follow-up visit", stage: 2 },
];
const STAGE_PILL = [
  "bg-rose-400/15 text-rose-300 ring-rose-400/30",
  "bg-emerald-400/15 text-emerald-300 ring-emerald-400/30",
  "bg-teal/15 text-[#5fe0e4] ring-teal/30",
];

const delay = (on: boolean, ms: number): CSSProperties => ({ transitionDelay: on ? `${ms}ms` : "0ms" });
const riseCls = (on: boolean) =>
  cx(
    "transition-all duration-700 ease-out motion-reduce:transition-none",
    on ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0 motion-reduce:translate-y-0 motion-reduce:opacity-100",
  );

function Cell({ h, today, on, ms }: { h: string; today: boolean; on: boolean; ms: number }) {
  const leave = h === "Leave";
  const off = h === "—";
  return (
    <span
      className={cx(
        "grid h-10 place-items-center rounded-xl text-[11px] font-semibold tabular-nums transition-all duration-500 ease-out motion-reduce:transition-none sm:h-11 sm:text-[11.5px]",
        on ? "scale-100 opacity-100" : "scale-75 opacity-0 motion-reduce:scale-100 motion-reduce:opacity-100",
        leave
          ? "bg-[repeating-linear-gradient(135deg,rgba(251,191,36,0.22)_0_6px,rgba(251,191,36,0.1)_6px_12px)] text-amber-300 ring-1 ring-amber-400/40"
          : off
            ? "border border-dashed border-white/15 text-slate-600"
            : today
              ? "bg-gradient-to-b from-teal/60 to-teal/30 text-white ring-1 ring-[#5fe0e4]/70 shadow-[0_0_18px_-4px_rgba(95,224,228,0.7)]"
              : "bg-gradient-to-b from-[#123f70] to-[#0b2a55] text-[#9fe7ea] ring-1 ring-white/10",
      )}
      style={delay(on, ms)}
    >
      {h}
    </span>
  );
}

export function AppointmentDetail() {
  const box = useRef<HTMLDivElement>(null);
  const on = useOnScreen(box, "-80px");

  return (
    <div ref={box} className="grid items-start gap-6 lg:grid-cols-[1.15fr_1fr] lg:gap-8">
      {/* ── The week */}
      <figure className="glass-dark relative overflow-hidden rounded-3xl p-5 sm:p-7">
        <div className="pointer-events-none absolute -left-20 -top-24 size-64 rounded-full bg-teal/20 blur-3xl" aria-hidden />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div>
            <figcaption className="text-[13px] font-semibold text-white">Doctor schedule · this week</figcaption>
            <p className="mt-0.5 text-[11.5px] text-slate-400">Working hours, leave and a daily cap per doctor</p>
          </div>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-slate-300 ring-1 ring-white/10">
            <span className="size-1.5 rounded-full bg-[#5fe0e4] shadow-[0_0_8px_#5fe0e4]" aria-hidden /> Today · Thu
          </span>
        </div>

        <div className="relative mt-6">
          {/* Phones: each doctor's name sits above their six days. */}
          <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-[8.5rem_repeat(6,minmax(0,1fr))]">
            <span className="hidden sm:block" />
            {DAYS.map((d, i) => (
              <span key={d} className={cx("pb-1 text-center text-[11px] font-medium", i === TODAY ? "text-[#5fe0e4]" : "text-slate-500")}>
                {d}
              </span>
            ))}
            {DOCS.map((doc, r) => (
              <div key={doc.n} className="contents">
                <div className={cx("col-span-6 flex items-center gap-2 pr-2 pt-2 sm:col-span-1 sm:pt-0", riseCls(on))} style={delay(on, 150 + r * 120)}>
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#5fe0e4] to-teal text-[10.5px] font-bold text-navy-900">
                    {doc.i}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-semibold text-white">{doc.n}</span>
                    <span className="block text-[10.5px] text-slate-400">cap {doc.cap}/day</span>
                  </span>
                </div>
                {doc.hours.map((h, c) => (
                  <Cell key={c} h={h} today={c === TODAY} on={on} ms={250 + r * 120 + c * 60} />
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Today against each cap. */}
        <ul className="relative mt-6 grid gap-3 sm:grid-cols-3">
          {DOCS.map((doc, r) => {
            const off = doc.hours[TODAY] === "—";
            return (
              <li key={doc.n} className={cx("rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/[0.07]", riseCls(on))} style={delay(on, 900 + r * 120)}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[11.5px] text-slate-300">{doc.n.replace("Dr. ", "Dr ")}</span>
                  <span className="text-[11px] font-semibold tabular-nums text-white">{off ? "Off today" : `${doc.today}/${doc.cap}`}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                  <div
                    className="h-full origin-left rounded-full bg-gradient-to-r from-teal to-[#5fe0e4] transition-transform duration-1000 ease-out motion-reduce:transition-none"
                    style={{ width: `${(doc.today / doc.cap) * 100}%`, transform: on ? "scaleX(1)" : "scaleX(0)", ...delay(on, 1100 + r * 120) }}
                  />
                </div>
              </li>
            );
          })}
        </ul>

        <p className={cx("relative mt-4 flex items-center gap-2 text-[11.5px] text-slate-400", riseCls(on))} style={delay(on, 1300)}>
          <ShieldCheck className="size-4 shrink-0 text-[#5fe0e4]" aria-hidden />
          Caps and leave are checked on every booking — at the desk and on WhatsApp.
        </p>
      </figure>

      {/* ── Recalls */}
      <figure className="glass-dark relative overflow-hidden rounded-3xl p-5 sm:p-7">
        <div className="pointer-events-none absolute -bottom-24 -right-16 size-64 rounded-full bg-emerald-400/10 blur-3xl" aria-hidden />
        <div className="relative">
          <figcaption className="text-[13px] font-semibold text-white">Recalls</figcaption>
          <p className="mt-0.5 text-[11.5px] text-slate-400">Bringing patients back when a visit falls due</p>
        </div>

        {/* Stage legend. */}
        <ol className="relative mt-6 grid grid-cols-3 gap-2" aria-hidden>
          {STAGES.map((s, i) => {
            const Icon = s.icon;
            return (
              <li key={s.k} className="flex flex-col items-center gap-1.5 text-center">
                <span className="grid size-9 place-items-center rounded-xl bg-white/[0.05] text-[#5fe0e4] ring-1 ring-white/10">
                  <Icon className="size-4" />
                </span>
                <span className="text-[10.5px] font-medium leading-tight text-slate-400">{s.k}</span>
                {i < 2 && <span className="sr-only">then</span>}
              </li>
            );
          })}
        </ol>

        <ul className="relative mt-5 space-y-3">
          {RECALLS.map((p, r) => (
            <li key={p.n} className={cx("rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/[0.07]", riseCls(on))} style={delay(on, 250 + r * 160)}>
              <div className="flex items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/[0.08] text-[11px] font-bold text-white ring-1 ring-white/10">{p.i}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-white">{p.n}</span>
                  <span className="block truncate text-[11px] text-slate-400">{p.r}</span>
                </span>
                <span className={cx("whitespace-nowrap rounded-full px-2.5 py-1 text-[10.5px] font-semibold ring-1", STAGE_PILL[p.stage])}>
                  {p.stage === 0 ? "Due today" : STAGES[p.stage].k}
                </span>
              </div>
              {/* The track: lights up stage by stage. */}
              <div className="relative mx-4 mt-3 flex items-center justify-between" aria-hidden>
                <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-white/[0.08]" />
                <span
                  className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 origin-left rounded-full bg-gradient-to-r from-teal to-[#5fe0e4] transition-transform duration-1000 ease-out motion-reduce:transition-none"
                  style={{ width: `${(p.stage / 2) * 100}%`, transform: on ? "scaleX(1)" : "scaleX(0)", ...delay(on, 600 + r * 220) }}
                />
                {STAGES.map((s, i) => {
                  const lit = i <= p.stage;
                  return (
                    <span
                      key={s.k}
                      className={cx(
                        "relative grid size-4 place-items-center rounded-full ring-2 transition-all duration-500 motion-reduce:transition-none",
                        on && lit ? "bg-[#5fe0e4] ring-[#5fe0e4]/40 shadow-[0_0_10px_#5fe0e4]" : "bg-navy-900 ring-white/15",
                      )}
                      style={delay(on, 600 + r * 220 + i * 350)}
                    >
                      {on && lit && <Check className="size-2.5 text-navy-900" strokeWidth={3.5} />}
                    </span>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      </figure>
    </div>
  );
}
