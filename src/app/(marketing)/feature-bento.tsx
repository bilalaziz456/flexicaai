import type { ComponentType, ReactNode } from "react";
import {
  CalendarClock,
  Fingerprint,
  History,
  MonitorSmartphone,
  Printer,
  RotateCcw,
  Wallet,
} from "lucide-react";
import { CountUp } from "./count-up";

/**
 * "Everything a practice runs on" — the capabilities that are not the headline
 * features, as a bento grid where each tile SHOWS its capability in a small piece of
 * product UI instead of describing it in a paragraph.
 *
 * Tile sizes carry meaning: scheduling and the money are what a practice owner looks
 * at every day, so they are the wide tiles; the rest are supporting guarantees.
 *
 * Every figure and name is illustrative. Specialty-agnostic throughout (CLAUDE.md §1).
 * Server-rendered apart from the count-up; each tile's artwork is decorative and its
 * heading and sentence carry the meaning for assistive tech.
 */

function Tile({
  Icon,
  title,
  body,
  children,
  className,
}: {
  Icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <article className={`group reveal-up mk-card mk-card-hover flex flex-col overflow-hidden ${className ?? ""}`}>
      <div className="relative flex-1 overflow-hidden border-b border-[var(--mk-line)] bg-gradient-to-b from-muted/70 to-transparent p-5 sm:p-6">
        <div aria-hidden="true" className="h-full">
          {children}
        </div>
      </div>
      <div className="p-6 sm:p-7">
        <h3 className="mk-h3 flex items-center gap-2.5">
          <Icon className="size-5 text-primary-text" />
          {title}
        </h3>
        <p className="mt-2 text-[0.95rem] leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </article>
  );
}

const pill = "rounded-full px-2 py-0.5 text-3xs font-semibold whitespace-nowrap";

export function FeatureBento() {
  return (
    <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-6">
      {/* ---- scheduling ---- */}
      <Tile
        className="lg:col-span-4"
        Icon={CalendarClock}
        title="Scheduling that respects reality"
        body="Working hours per provider, split shifts, leave, daily limits and a first-come queue number. If a booking breaks one of your rules, it tells you instead of double-booking someone."
      >
        <div className="grid h-full grid-cols-3 gap-2.5">
          {[
            { who: "Dr. Sana", hours: "09:00–13:00 · 17:00–20:00", slots: ["#1 10:00", "#2 10:30", "#3 11:15"], note: null },
            { who: "Dr. Ali", hours: "10:00–16:00", slots: ["#1 10:00", "#2 11:00"], note: "Daily limit reached" },
            { who: "Dr. Hina", hours: "On leave", slots: [], note: "Leave · Mon–Wed" },
          ].map((col) => (
            <div key={col.who} className="flex min-w-0 flex-col rounded-xl bg-card p-2.5 shadow-[0_0_0_1px_var(--mk-line)]">
              <p className="truncate text-2xs font-semibold">{col.who}</p>
              <p className="truncate text-3xs text-muted-foreground">{col.hours}</p>
              <div className="mt-2 space-y-1.5">
                {col.slots.map((s) => (
                  <div
                    key={s}
                    className="truncate rounded-md bg-brand-teal/10 px-2 py-1 font-mono text-3xs text-primary-text shadow-[inset_2px_0_0_var(--brand-teal)] transition-transform duration-500 group-hover:translate-x-0.5"
                  >
                    {s}
                  </div>
                ))}
                {col.note ? (
                  <div className={`${pill} block w-fit max-w-full truncate bg-warning/15 text-warning-text`}>{col.note}</div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </Tile>

      {/* ---- access ---- */}
      <Tile
        className="lg:col-span-2"
        Icon={Fingerprint}
        title="Only what the role needs"
        body="Access is granted per person, per capability. A front-desk account does not see clinical notes unless you decide it should."
      >
        <div className="space-y-2">
          {[
            { label: "Appointments", on: true },
            { label: "Payments", on: true },
            { label: "Clinical notes", on: false },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between rounded-xl bg-card px-3 py-2 shadow-[0_0_0_1px_var(--mk-line)]">
              <span className="text-2xs font-medium">{row.label}</span>
              <span
                className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${row.on ? "bg-brand-teal" : "bg-foreground/15"}`}
              >
                <span className={`absolute size-3 rounded-full bg-white shadow ${row.on ? "right-0.5" : "left-0.5"}`} />
              </span>
            </div>
          ))}
          <p className="pt-1 text-center text-3xs text-muted-foreground">Front desk · Ayesha</p>
        </div>
      </Tile>

      {/* ---- the money ---- */}
      <Tile
        className="lg:col-span-3"
        Icon={Wallet}
        title="Where the money actually went"
        body="Revenue earned, what each provider is owed and has been paid, expenses and profit — from the records your team already keeps, so there is no second spreadsheet."
      >
        <div className="flex h-full flex-col justify-between gap-4 rounded-xl bg-card p-4 shadow-[0_0_0_1px_var(--mk-line)]">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-3xs text-muted-foreground">Net profit · this month</p>
              <p className="text-2xl font-semibold tracking-tight">
                <CountUp value={548300} prefix="Rs " />
              </p>
            </div>
            <span className={`${pill} bg-success/12 text-success-text`}>After shares & expenses</span>
          </div>
          <div className="space-y-2">
            {[
              { label: "Collected", w: "100%", c: "from-brand-teal to-brand-blue" },
              { label: "Provider shares", w: "34%", c: "from-foreground/30 to-foreground/20" },
              { label: "Expenses", w: "27%", c: "from-foreground/25 to-foreground/15" },
            ].map((b) => (
              <div key={b.label} className="grid grid-cols-[88px_1fr] items-center gap-3">
                <span className="text-3xs text-muted-foreground">{b.label}</span>
                <span className="h-2 overflow-hidden rounded-full bg-foreground/[0.06]">
                  <span
                    className={`block h-full origin-left rounded-full bg-gradient-to-r ${b.c} transition-transform duration-700 group-hover:scale-x-[1.03]`}
                    style={{ width: b.w }}
                  />
                </span>
              </div>
            ))}
          </div>
        </div>
      </Tile>

      {/* ---- printing ---- */}
      <Tile
        className="lg:col-span-3"
        Icon={Printer}
        title="Prints the way your desk already prints"
        body="Numbered invoices and receipts on a thermal roll, A5 or A4 — so nobody has to buy a new printer or change a habit to start using it."
      >
        <div className="flex h-full items-end justify-center gap-4">
          {[
            { name: "Thermal", w: "w-14", h: "h-28" },
            { name: "A5", w: "w-20", h: "h-24" },
            { name: "A4", w: "w-24", h: "h-32" },
          ].map((p, i) => (
            <div key={p.name} className="flex flex-col items-center gap-2">
              <div
                className={`${p.w} ${p.h} rounded-md bg-card p-2 shadow-[0_0_0_1px_var(--mk-line),var(--mk-shadow)] transition-transform duration-500 group-hover:-translate-y-1`}
                style={{ transitionDelay: `${i * 60}ms` }}
              >
                <span className="block h-1.5 w-2/3 rounded-full bg-foreground/20" />
                <span className="mt-1.5 block h-1 w-full rounded-full bg-foreground/10" />
                <span className="mt-1 block h-1 w-5/6 rounded-full bg-foreground/10" />
                <span className="mt-1 block h-1 w-full rounded-full bg-foreground/10" />
                <span className="mt-2.5 block h-1.5 w-1/2 rounded-full bg-brand-teal/60" />
              </div>
              <span className="font-mono text-3xs text-muted-foreground">{p.name}</span>
            </div>
          ))}
        </div>
      </Tile>

      {/* ---- nothing deleted ---- */}
      <Tile
        className="lg:col-span-3"
        Icon={History}
        title="Nothing is ever really deleted"
        body="Deleting moves a record to a trash you can restore from, with who did it and when. Mistakes can be undone and every action has a name against it."
      >
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 rounded-xl bg-card px-3 py-2.5 shadow-[0_0_0_1px_var(--mk-line)]">
            <span className="min-w-0">
              <span className="block truncate text-2xs font-medium">Appointment · Fatima Noor</span>
              <span className="block truncate text-3xs text-muted-foreground">Deleted by Ayesha · 11:42</span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-teal px-2.5 py-1 text-3xs font-semibold text-brand-navy transition-transform duration-300 group-hover:scale-105">
              <RotateCcw className="size-3" />
              Restore
            </span>
          </div>
          {["Invoice INV-2026-0000142 issued", "Note approved by Dr. Sana", "Payment recorded · Rs 10,000"].map((t, i) => (
            <div key={t} className="flex items-center gap-2.5 px-1 text-3xs text-muted-foreground">
              <span className={`size-1.5 shrink-0 rounded-full ${i === 0 ? "bg-brand-teal" : "bg-foreground/20"}`} />
              <span className="truncate">{t}</span>
            </div>
          ))}
        </div>
      </Tile>

      {/* ---- any device ---- */}
      <Tile
        className="lg:col-span-3"
        Icon={MonitorSmartphone}
        title="On whatever is in the room"
        body="Record on a phone, review on a tablet, bill at the front desk. It runs in the browser, so there is nothing to install on any of them."
      >
        <div className="flex h-full items-end justify-center gap-3">
          <div className="h-20 w-11 rounded-lg bg-card p-1 shadow-[0_0_0_1px_var(--mk-line-strong),var(--mk-shadow)] transition-transform duration-500 group-hover:-translate-y-1">
            <div className="flex h-full flex-col items-center justify-center gap-0.5 rounded-md bg-brand-teal/10">
              {[50, 90, 60, 100, 40].map((h, i) => (
                <span key={i} className="w-4 rounded-full bg-brand-teal/60" style={{ height: 2, width: `${h * 0.22}px` }} />
              ))}
            </div>
          </div>
          <div className="h-24 w-20 rounded-xl bg-card p-1.5 shadow-[0_0_0_1px_var(--mk-line-strong),var(--mk-shadow)] transition-transform delay-75 duration-500 group-hover:-translate-y-1">
            <div className="h-full space-y-1 rounded-md bg-muted p-1.5">
              <span className="block h-1 w-2/3 rounded-full bg-foreground/20" />
              <span className="block h-1 w-full rounded-full bg-foreground/10" />
              <span className="block h-1 w-5/6 rounded-full bg-foreground/10" />
              <span className="mt-2 block w-fit rounded-full bg-success/15 px-1 text-[7px] font-semibold text-success-text">OK</span>
            </div>
          </div>
          <div className="flex flex-col items-center transition-transform delay-150 duration-500 group-hover:-translate-y-1">
            <div className="h-20 w-32 rounded-t-lg bg-card p-1.5 shadow-[0_0_0_1px_var(--mk-line-strong),var(--mk-shadow)]">
              <div className="grid h-full grid-cols-[10px_1fr] gap-1 rounded bg-muted p-1">
                <span className="rounded-sm bg-foreground/10" />
                <span className="space-y-1">
                  <span className="block h-1 w-1/2 rounded-full bg-foreground/20" />
                  <span className="block h-3 rounded-sm bg-brand-teal/20" />
                  <span className="block h-1 w-full rounded-full bg-foreground/10" />
                </span>
              </div>
            </div>
            <div className="h-1.5 w-40 rounded-b-md bg-foreground/15" />
          </div>
        </div>
      </Tile>
    </div>
  );
}
