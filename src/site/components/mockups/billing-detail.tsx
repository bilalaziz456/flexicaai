"use client";

import { Banknote, Check, FileText, Landmark, Printer, Receipt, ShieldCheck, Wallet } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useOnScreen } from "../story/webgl";
import { cx } from "../ui";
import { SAMPLE } from "./frame";

/**
 * Billing and payments, in detail: the day's collections by payment method (with the
 * deposit held apart from revenue and the cash drawer reconciled at handover), and a
 * treatment plan with its estimate on the clinic letterhead. Animates in when it
 * scrolls into view; still for reduced motion. Invented sample data.
 */

const PAYMENTS = [
  { n: SAMPLE.patient, m: "Cash", v: 12000, r: "RCP-01183", icon: Banknote, tone: "teal" },
  { n: "Bilal Ahmed", m: "Cheque", v: 4500, r: "RCP-01184", icon: Receipt, tone: "violet" },
  { n: "Hina Raza", m: "Bank transfer", v: 9000, r: "RCP-01185", icon: Landmark, tone: "sky" },
  { n: "Fatima Shah", m: "Deposit held", v: 5000, r: "DEP-00217", icon: Wallet, tone: "amber" },
] as const;
const COLLECTED = PAYMENTS.filter((p) => p.tone !== "amber").reduce((s, p) => s + p.v, 0);
const HELD = PAYMENTS.filter((p) => p.tone === "amber").reduce((s, p) => s + p.v, 0);

const TONE = {
  teal: { bar: "bg-teal", chip: "bg-teal/15 text-[#5fe0e4] ring-teal/30" },
  sky: { bar: "bg-sky-400", chip: "bg-sky-400/15 text-sky-300 ring-sky-400/30" },
  violet: { bar: "bg-violet-400", chip: "bg-violet-400/15 text-violet-300 ring-violet-400/30" },
  amber: { bar: "bg-amber-400", chip: "bg-amber-400/15 text-amber-300 ring-amber-400/30" },
} as const;

const PLAN = [
  { t: "Minor surgery · cyst excision", d: "Procedure", v: 18000 },
  { t: "Physiotherapy · 6 sessions", d: "Service", v: 22000 },
  { t: "Follow-up consultations · 3", d: "Consultation", v: 4500 },
];
const PLAN_DISC = 2500;
const ESTIMATE = PLAN.reduce((s, l) => s + l.v, 0) - PLAN_DISC;

const n = (v: number) => v.toLocaleString("en-US");

/** Counts up to `to` while `on`; jumps straight there for reduced motion. */
function useCount(to: number, on: boolean, ms = 1200, delay = 0) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!on) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const t0 = performance.now() + (reduce ? 0 : delay);
    const tick = (now: number) => {
      const k = reduce ? 1 : Math.min(1, Math.max(0, (now - t0) / ms));
      setV(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, on, ms, delay]);
  return v;
}

/** Fade-and-rise in, after `ms`. */
const rise = (on: boolean, ms: number): CSSProperties => ({
  transitionDelay: on ? `${ms}ms` : "0ms",
});
const riseCls = (on: boolean) =>
  cx("transition-all duration-700 ease-out motion-reduce:transition-none", on ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0 motion-reduce:translate-y-0 motion-reduce:opacity-100");

export function BillingDetail() {
  const box = useRef<HTMLDivElement>(null);
  const on = useOnScreen(box, "-80px");
  const collected = useCount(COLLECTED, on, 1300, 150);
  const estimate = useCount(ESTIMATE, on, 1300, 1100);

  return (
    <div ref={box} className="grid items-start gap-6 lg:grid-cols-2 lg:gap-8">
      {/* ── Today's collections */}
      <figure className="glass-dark relative overflow-hidden rounded-3xl p-5 sm:p-7">
        <div className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full bg-teal/20 blur-3xl" aria-hidden />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div>
            <figcaption className="text-[13px] font-semibold text-white">Today&apos;s collections</figcaption>
            <p className="mt-0.5 text-[11.5px] text-slate-400">{SAMPLE.clinic} · {SAMPLE.day}</p>
          </div>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-slate-300 ring-1 ring-white/10">
            <Printer className="size-3.5 text-[#5fe0e4]" aria-hidden /> Receipts: thermal · A5 · A4
          </span>
        </div>

        <p className="relative mt-6 text-[2.1rem] font-semibold leading-none tracking-tight text-white tabular-nums sm:text-[2.5rem]">
          Rs {n(collected)}
        </p>
        <p className="relative mt-2 text-[12px] text-slate-400">
          collected · <span className="text-amber-300">+ Rs {n(HELD)} deposit held</span>, not yet revenue
        </p>

        {/* Split by payment method. */}
        <div className="relative mt-5 flex h-2.5 gap-1 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
          {PAYMENTS.filter((p) => p.tone !== "amber").map((p, i) => (
            <span
              key={p.m}
              className={cx("h-full origin-left rounded-full transition-transform duration-1000 ease-out motion-reduce:transition-none", TONE[p.tone].bar, on ? "scale-x-100" : "scale-x-0 motion-reduce:scale-x-100")}
              style={{ width: `${(p.v / COLLECTED) * 100}%`, ...rise(on, 300 + i * 180) }}
            />
          ))}
        </div>
        <ul className="relative mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400" aria-hidden>
          {PAYMENTS.filter((p) => p.tone !== "amber").map((p) => (
            <li key={p.m} className="flex items-center gap-1.5">
              <span className={cx("size-2 rounded-full", TONE[p.tone].bar)} /> {p.m}
            </li>
          ))}
        </ul>

        <ul className="relative mt-6 space-y-2">
          {PAYMENTS.map((p, i) => {
            const Icon = p.icon;
            return (
              <li
                key={p.r}
                className={cx("flex items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-2.5 ring-1 ring-white/[0.07]", riseCls(on))}
                style={rise(on, 450 + i * 140)}
              >
                <span className={cx("grid size-9 shrink-0 place-items-center rounded-xl ring-1", TONE[p.tone].chip)}>
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-white">{p.n}</span>
                  <span className="block text-[11px] text-slate-400">
                    {p.m} · {p.r}
                  </span>
                </span>
                <span className={cx("text-right text-[14px] font-semibold tabular-nums", p.tone === "amber" ? "text-amber-300" : "text-white")}>{n(p.v)}</span>
              </li>
            );
          })}
        </ul>

        <div
          className={cx("relative mt-4 flex items-center justify-between gap-3 rounded-2xl border border-dashed border-teal/30 px-3 py-2.5", riseCls(on))}
          style={rise(on, 1100)}
        >
          <span className="flex items-center gap-2 text-[12px] text-slate-300">
            <ShieldCheck className="size-4 text-[#5fe0e4]" aria-hidden /> Cash drawer · handover
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-400/30">
            <Check className="size-3.5" aria-hidden /> Reconciled
          </span>
        </div>
      </figure>

      {/* ── Treatment plan on the letterhead */}
      <figure className="glass-dark relative overflow-hidden rounded-3xl p-5 sm:p-7 [perspective:1200px]">
        <div className="pointer-events-none absolute -bottom-24 -left-16 size-64 rounded-full bg-sky-400/15 blur-3xl" aria-hidden />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div>
            <figcaption className="text-[13px] font-semibold text-white">Treatment plan &amp; estimate</figcaption>
            <p className="mt-0.5 text-[11.5px] text-slate-400">Procedures, services and a plan discount</p>
          </div>
          <span className="rounded-full bg-sky-400/15 px-2.5 py-1 text-[11px] font-semibold text-sky-300 ring-1 ring-sky-400/30">Proposed</span>
        </div>

        {/* The letterhead page tilts up into place. */}
        <div
          className={cx(
            "relative mt-6 origin-bottom rounded-2xl bg-white p-4 text-ink shadow-[0_30px_60px_-20px_rgba(0,0,0,0.6)] transition-all duration-1000 ease-out motion-reduce:transition-none sm:p-5",
            on ? "opacity-100 [transform:rotateX(0deg)]" : "opacity-0 [transform:rotateX(18deg)_translateY(16px)] motion-reduce:opacity-100 motion-reduce:[transform:none]",
          )}
          style={rise(on, 150)}
        >
          <div className="flex items-center justify-between border-b-2 border-teal pb-3">
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-[#5fe0e4] to-teal text-[12px] font-bold text-navy-900">CC</span>
              <div>
                <p className="text-[13px] font-semibold text-navy-800">{SAMPLE.clinic}</p>
                <p className="text-[10.5px] text-ink-mute">Clinic letterhead</p>
              </div>
            </div>
            <p className="text-right text-[10.5px] leading-snug text-ink-mute">
              {SAMPLE.patient}
              <br />
              MRN {SAMPLE.mrn}
            </p>
          </div>

          <ul className="mt-2 divide-y divide-mist-200">
            {PLAN.map((l, i) => (
              <li key={l.t} className={cx("flex items-center justify-between gap-3 py-2.5", riseCls(on))} style={rise(on, 650 + i * 150)}>
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-ink">{l.t}</span>
                  <span className="block text-[10.5px] text-ink-mute">{l.d}</span>
                </span>
                <span className="text-[12.5px] tabular-nums text-ink">Rs {n(l.v)}</span>
              </li>
            ))}
          </ul>

          <div className={cx("mt-1 flex items-center justify-between gap-3 border-t border-mist-200 pt-2.5", riseCls(on))} style={rise(on, 1100)}>
            <span className="text-[12px] text-teal-ink">Plan discount</span>
            <span className="text-[12px] tabular-nums text-teal-ink">− Rs {n(PLAN_DISC)}</span>
          </div>
          <div className="mt-3 flex items-end justify-between rounded-xl bg-mist px-3 py-3">
            <span className="text-[12px] font-semibold text-ink">Estimate</span>
            <span className="text-[1.45rem] font-semibold leading-none tracking-tight text-navy-800 tabular-nums">Rs {n(estimate)}</span>
          </div>
        </div>

        <ul className="relative mt-5 flex flex-wrap gap-2 text-[11px] font-medium text-slate-300" aria-hidden>
          <li className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 ring-1 ring-white/10">
            <FileText className="size-3.5 text-[#5fe0e4]" /> Prints on the clinic letterhead
          </li>
        </ul>
      </figure>
    </div>
  );
}
