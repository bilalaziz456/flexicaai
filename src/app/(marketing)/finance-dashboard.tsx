import type { ComponentType, CSSProperties } from "react";
import {
  ArrowUpRight,
  Banknote,
  BarChart3,
  CalendarDays,
  Clock3,
  Percent,
  Receipt,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";
import { CountUp } from "./count-up";
import { RevenueChart } from "./revenue-chart";

/**
 * The billing page's hero: a practice's finance overview, composed as one dashboard
 * rather than a scatter of cards. Hierarchy follows what an owner asks first — how much
 * came in (large), then what was billed, what is still owed and what providers are
 * owed (smaller), then the trend, then what needs attention.
 *
 * "Flagged for you" is NOT presented as AI, because billing has none. Each flag is
 * something the product genuinely surfaces from the ledger: receivables and how overdue
 * they are, discounts held back until approved, provider balances, and the comparison
 * with the previous 30 days the dashboard already shows (ADR-031). Claiming a model was
 * behind them would be claiming a feature.
 *
 * Every figure is a sample practice. Invoice and receipt numbers use the product's real
 * formats. Server-rendered apart from the chart and the count-ups.
 */

const TREND = [
  { label: "Jul 7", billed: 312000, collected: 268000 },
  { label: "Jul 14", billed: 298000, collected: 271000 },
  { label: "Jul 21", billed: 341000, collected: 289000 },
  { label: "Jul 28", billed: 326000, collected: 301000 },
  { label: "Aug 4", billed: 355000, collected: 312000 },
  { label: "Aug 11", billed: 348000, collected: 326000 },
  { label: "Aug 18", billed: 372000, collected: 331000 },
  { label: "Aug 25", billed: 366000, collected: 344000 },
  { label: "Sep 1", billed: 389000, collected: 352000 },
  { label: "Sep 8", billed: 401000, collected: 368000 },
  { label: "Sep 15", billed: 412000, collected: 384200 },
];

const PAYMENTS = [
  { no: "RCP-2026-0000214", who: "Ayesha Khan", method: "Cash", amount: 8000, note: "Paid in full" },
  { no: "RCP-2026-0000213", who: "Imran Qureshi", method: "Bank", amount: 10000, note: "Part payment · Rs 8,000 due" },
  { no: "RCP-2026-0000212", who: "Fatima Noor", method: "Advance", amount: 5000, note: "From credit held" },
  { no: "RCP-2026-0000211", who: "Hamza Siddiqui", method: "Cash", amount: 3500, note: "Paid in full" },
];

const FLAGS: {
  Icon: ComponentType<{ className?: string }>;
  tone: "warn" | "info" | "good";
  title: string;
  body: string;
  action: string;
}[] = [
  {
    Icon: Clock3,
    tone: "warn",
    title: "Rs 1,76,500 owed by 9 patients",
    body: "3 of them for more than 30 days.",
    action: "Open receivables",
  },
  {
    Icon: Percent,
    tone: "info",
    title: "2 discounts waiting for approval",
    body: "Not counted in revenue until someone signs them off.",
    action: "Review",
  },
  {
    Icon: ArrowUpRight,
    tone: "good",
    title: "Collections up 12% on the previous 30 days",
    body: "The same comparison the finance dashboard makes for every period.",
    action: "See trend",
  },
];

const TONE = {
  warn: { chip: "bg-warning/15 text-warning-text", dot: "var(--warning)" },
  info: { chip: "bg-info/12 text-info-text", dot: "var(--info)" },
  good: { chip: "bg-success/12 text-success-text", dot: "var(--success)" },
};

/** A small trend line under a KPI, so the figure reads as a direction, not a snapshot. */
function Spark({ points, tone }: { points: number[]; tone?: "warn" }) {
  const max = Math.max(...points);
  const min = Math.min(...points);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${((i / (points.length - 1)) * 100).toFixed(1)},${(28 - ((p - min) / (max - min || 1)) * 24).toFixed(1)}`)
    .join(" ");
  const stroke = tone === "warn" ? "var(--warning)" : "var(--brand-teal)";
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="mt-auto h-8 w-full pt-3" fill="none">
      <path d={`${path} L100,30 L0,30 Z`} fill={stroke} fillOpacity="0.1" />
      <path d={path} stroke={stroke} strokeWidth="1.75" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function Kpi({
  label,
  value,
  sub,
  Icon,
  tone,
  delay,
  trend,
}: {
  label: string;
  value: number;
  sub: string;
  Icon: ComponentType<{ className?: string }>;
  tone?: "warn";
  delay: number;
  trend: number[];
}) {
  return (
    <div className="mk-rise flex h-full flex-col rounded-2xl bg-card p-4 shadow-[0_0_0_1px_var(--mk-line)] sm:p-5" style={{ "--mk-delay": `${delay}ms` } as CSSProperties}>
      <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className={`size-3.5 ${tone === "warn" ? "text-warning-text" : ""}`} />
        {label}
      </p>
      <p className={`mt-2 text-xl font-semibold tracking-[-0.02em] sm:text-2xl ${tone === "warn" ? "text-warning-text" : ""}`}>
        <CountUp value={value} prefix="Rs " delay={delay} />
      </p>
      <p className="mt-1 text-2xs text-muted-foreground">{sub}</p>
      <Spark points={trend} tone={tone} />
    </div>
  );
}

export function FinanceDashboard() {
  return (
    <div className="mk-frame relative rounded-[2rem] bg-card/70 text-left backdrop-blur-xl">
      {/* App bar. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--mk-line)] px-5 py-3.5 sm:px-7">
        <div className="flex items-center gap-2">
          {["Overview", "Receivables", "Payments", "Provider shares"].map((tab, i) => (
            <span
              key={tab}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                i === 0 ? "bg-foreground text-background" : "hidden text-muted-foreground sm:inline"
              }`}
            >
              {tab}
            </span>
          ))}
        </div>
        <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-[0_0_0_1px_var(--mk-line)]">
          <CalendarDays className="size-3.5" /> Last 30 days
        </span>
      </div>

      <div className="space-y-4 p-4 sm:space-y-5 sm:p-6">
        {/* ---- the headline number, then its context ---- */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,2fr)] sm:gap-5">
          <div
            className="mk-rise relative isolate overflow-hidden rounded-2xl bg-gradient-to-br from-brand-navy via-[#0b3a6e] to-brand-blue p-5 text-white sm:p-6"
            style={{ "--mk-delay": "250ms" } as CSSProperties}
          >
            <div aria-hidden="true" className="absolute -top-16 -right-10 -z-10 size-48 rounded-full bg-brand-teal/40 blur-3xl" />
            <p className="flex items-center gap-2 text-xs font-medium text-white/75">
              <Wallet className="size-3.5" /> Collected
            </p>
            <p className="mt-3 text-4xl font-bold tracking-[-0.04em] sm:text-5xl">
              <CountUp value={1428500} prefix="Rs " delay={250} />
            </p>
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/12 px-2.5 py-1 text-xs font-semibold text-[#8ff0c0]">
              <ArrowUpRight className="size-3.5" /> 12% vs previous 30 days
            </p>
            <div className="mt-5">
              <div className="flex justify-between text-2xs text-white/70">
                <span>Collected of billed</span>
                <span>89%</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/15">
                <span className="mk-grow-x block h-full w-[89%] rounded-full bg-gradient-to-r from-brand-teal to-[#8ff0c0]" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-3">
            <Kpi label="Billed" value={1605000} sub="From 412 completed visits" Icon={Receipt} delay={350} trend={[31, 30, 34, 33, 36, 35, 37, 37, 39, 40, 41]} />
            <Kpi label="Outstanding" value={176500} sub="Across 9 patients" Icon={Clock3} tone="warn" delay={450} trend={[44, 41, 43, 38, 36, 33, 34, 30, 29, 27, 25]} />
            <div className="col-span-2 lg:col-span-1">
              <Kpi label="Owed to providers" value={214300} sub="Shares earned, not yet paid" Icon={Users} delay={550} trend={[18, 21, 19, 24, 22, 20, 23, 25, 22, 21, 21]} />
            </div>
          </div>
        </div>

        {/* ---- trend + flags ---- */}
        <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="mk-rise flex flex-col justify-between rounded-2xl bg-card p-4 shadow-[0_0_0_1px_var(--mk-line)] sm:p-5" style={{ "--mk-delay": "600ms" } as CSSProperties}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <BarChart3 className="size-4 text-primary-text" /> Collected vs billed
              </p>
              <span className="flex items-center gap-4 text-2xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-4 rounded-full bg-gradient-to-r from-brand-blue to-brand-teal" /> Collected
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-4 rounded-full bg-foreground/30" /> Billed
                </span>
              </span>
            </div>
            <div className="mt-4 text-foreground">
              <RevenueChart data={TREND} />
            </div>
            <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-[var(--mk-line)] pt-4 text-left">
              {[
                ["Average week", "Rs 3,22,700"],
                ["Best week", "Sep 15"],
                ["Collection rate", "89%"],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-2xs text-muted-foreground">{k}</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="mk-rise rounded-2xl bg-card p-4 shadow-[0_0_0_1px_var(--mk-line)] sm:p-5" style={{ "--mk-delay": "700ms" } as CSSProperties}>
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4 text-primary-text" /> Flagged for you
            </p>
            <p className="mt-1 text-2xs text-muted-foreground">Worked out from the ledger, every time it changes.</p>
            <ul className="mt-4 space-y-3">
              {FLAGS.map(({ Icon, tone, title, body, action }, i) => (
                <li
                  key={title}
                  className="mk-rise group relative rounded-xl bg-muted/60 p-3.5 transition-colors hover:bg-muted"
                  style={{ "--mk-delay": `${900 + i * 180}ms` } as CSSProperties}
                >
                  <div className="flex gap-3">
                    <span className={`relative inline-flex size-8 shrink-0 items-center justify-center rounded-lg ${TONE[tone].chip}`}>
                      <Icon className="size-4" />
                      <span
                        className="absolute -top-0.5 -right-0.5 size-2 rounded-full motion-safe:animate-pulse"
                        style={{ background: TONE[tone].dot }}
                      />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold leading-snug">{title}</p>
                      <p className="mt-0.5 text-2xs leading-snug text-muted-foreground">{body}</p>
                      <p className="mt-1.5 inline-flex items-center gap-1 text-2xs font-semibold text-primary-text">
                        {action} <ArrowUpRight className="size-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ---- payments + invoice ---- */}
        <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="mk-rise rounded-2xl bg-card p-4 shadow-[0_0_0_1px_var(--mk-line)] sm:p-5" style={{ "--mk-delay": "800ms" } as CSSProperties}>
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Banknote className="size-4 text-primary-text" /> Payments today
            </p>
            <ul className="mt-3 divide-y divide-[var(--mk-line)]">
              {PAYMENTS.map((p, i) => (
                <li
                  key={p.no}
                  className="mk-rise grid grid-cols-[1fr_auto] items-center gap-3 py-3 sm:grid-cols-[10.5rem_1fr_4.5rem_auto]"
                  style={{ "--mk-delay": `${1000 + i * 110}ms` } as CSSProperties}
                >
                  <span className="hidden font-mono text-2xs text-muted-foreground sm:block">{p.no}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{p.who}</span>
                    <span className="block truncate text-2xs text-muted-foreground">{p.note}</span>
                  </span>
                  <span className="hidden justify-self-start rounded-full bg-foreground/[0.06] px-2 py-0.5 text-3xs font-semibold text-muted-foreground sm:block">
                    {p.method}
                  </span>
                  <span className="text-sm font-semibold tabular-nums">Rs {p.amount.toLocaleString("en-IN")}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mk-rise flex flex-col rounded-2xl bg-card p-4 shadow-[0_0_0_1px_var(--mk-line)] sm:p-5" style={{ "--mk-delay": "900ms" } as CSSProperties}>
            <div className="flex items-start justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Receipt className="size-4 text-primary-text" /> Invoice
              </p>
              <span className="font-mono text-3xs text-muted-foreground">INV-2026-0000142</span>
            </div>
            <dl className="mt-4 space-y-2 text-xs">
              {[
                ["Consultation", "2,000"],
                ["Procedure", "18,000"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-mono tabular-nums">{v}</dd>
                </div>
              ))}
              <div className="flex justify-between">
                <dt className="inline-flex items-center gap-1.5 text-muted-foreground">
                  Discount <span className="rounded-full bg-success/12 px-1.5 text-3xs font-semibold text-success-text">Approved</span>
                </dt>
                <dd className="font-mono tabular-nums">−2,000</dd>
              </div>
              <div className="flex justify-between border-t border-[var(--mk-line)] pt-2 text-sm font-semibold">
                <dt>Total</dt>
                <dd className="font-mono tabular-nums">Rs 18,000</dd>
              </div>
            </dl>
            <div className="mt-auto pt-4">
              <div className="flex justify-between text-2xs text-muted-foreground">
                <span>Paid Rs 10,000</span>
                <span className="font-semibold text-warning-text">Rs 8,000 due</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-foreground/[0.07]">
                <span className="mk-grow-x block h-full w-[56%] rounded-full bg-gradient-to-r from-brand-blue to-brand-teal" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
