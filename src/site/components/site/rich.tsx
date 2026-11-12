import {
  ArrowRight,
  AudioLines,
  BadgeCheck,
  Bot,
  CalendarClock,
  CalendarDays,
  ChartColumnIncreasing,
  ClipboardList,
  Clock,
  CreditCard,
  FileChartColumn,
  FileText,
  HandCoins,
  HeartPulse,
  Inbox,
  ListChecks,
  MessageCircle,
  Mic,
  Percent,
  Pill,
  Printer,
  Receipt,
  RefreshCw,
  Sparkles,
  TrendingUp,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { FEATURE_LINKS, featurePath, type FeatureSlug } from "../../lib/nav";
import { cx } from "../ui";

/**
 * Richer building blocks for the inner pages' text sections: icon tiles, cursor-lit
 * cards, timelines with travelling light, a flow chain and a hub diagram. All plain
 * server-rendered HTML; the motion is CSS, and PageMotion feeds the cursor light.
 */

export const FEATURE_ICON: Record<FeatureSlug, LucideIcon> = {
  "patient-management": UserRound,
  "appointment-management": CalendarDays,
  "ai-scribe": Mic,
  "whatsapp-integration": MessageCircle,
  "clinic-analytics": ChartColumnIncreasing,
  "billing-and-payments": Receipt,
};

/** An icon for a feature sub-section, picked from its heading. */
const SECTION_ICONS: [RegExp, LucideIcon][] = [
  [/prescription/i, Pill],
  [/history/i, HeartPulse],
  [/treatment|estimate/i, ClipboardList],
  [/record/i, FileText],
  [/working hours|caps|leave/i, Clock],
  [/scheduled|completed|glance/i, ListChecks],
  [/dictate/i, Mic],
  [/unclear|audio/i, AudioLines],
  [/approve/i, BadgeCheck],
  [/lifecycle/i, RefreshCw],
  [/reschedule|replying/i, CalendarClock],
  [/AI repl|questions/i, Bot],
  [/workspace|conversation/i, Inbox],
  [/shares/i, HandCoins],
  [/expenses|petty|P&L/i, Wallet],
  [/sales/i, TrendingUp],
  [/report/i, FileChartColumn],
  [/discount/i, Percent],
  [/payment|deposit|credit/i, CreditCard],
  [/print/i, Printer],
  [/invoice/i, Receipt],
  [/WhatsApp/i, MessageCircle],
];
export const iconFor = (heading: string): LucideIcon => SECTION_ICONS.find(([re]) => re.test(heading))?.[1] ?? Sparkles;

export function IconTile({ icon: Icon, size = "md", className }: { icon: LucideIcon; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span
      className={cx(
        "icon-tile grid shrink-0 place-items-center",
        size === "sm" && "size-9 rounded-xl",
        size === "md" && "size-12 rounded-2xl",
        size === "lg" && "size-14 rounded-2xl",
        className,
      )}
      aria-hidden
    >
      <Icon className={size === "sm" ? "size-4" : size === "md" ? "size-5" : "size-6"} strokeWidth={1.9} />
    </span>
  );
}

/** Two slow colour lights drifting behind a band. */
export function Ambient({ dark = false }: { dark?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className={cx("orb -left-24 top-10 size-[420px]", dark ? "bg-teal/20" : "bg-teal/15")} />
      <div className={cx("orb -right-24 bottom-0 size-[380px] [animation-delay:-8s]", dark ? "bg-blue/20" : "bg-navy-600/10")} />
      <div className={cx("absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_40%,black,transparent)]", dark ? "grid-dots-dark" : "grid-dots opacity-70")} />
    </div>
  );
}

/** A card the cursor lights up. */
export function SpotCard({
  children,
  dark = false,
  className,
  tilt = true,
}: {
  children: ReactNode;
  dark?: boolean;
  className?: string;
  tilt?: boolean;
}) {
  return (
    <div
      data-tilt={tilt ? "" : undefined}
      className={cx(
        "spot h-full rounded-[1.6rem] p-7 sm:p-8",
        dark
          ? "glass-dark"
          : "border border-mist-200 bg-white/90 shadow-[0_1px_2px_rgb(8_41_87/0.05),0_24px_50px_-30px_rgb(8_41_87/0.35)] backdrop-blur",
        className,
      )}
    >
      {children}
    </div>
  );
}

type Step = { t: string; d: string; icon?: LucideIcon };

/** Numbered steps across the page, joined by a line with light running along it. */
export function StepTimeline({ steps, dark = false }: { steps: Step[]; dark?: boolean }) {
  return (
    <div className="relative mt-14">
      <div className={cx("beam absolute top-7 hidden h-px md:block", steps.length === 4 ? "left-[12.5%] right-[12.5%]" : "left-[16.7%] right-[16.7%]", dark ? "bg-white/15" : "bg-mist-300")} aria-hidden />
      <ol className={cx("relative grid gap-6", steps.length === 4 ? "md:grid-cols-4" : "md:grid-cols-3")}>
        {steps.map((s, i) => {
          const Icon = s.icon ?? Sparkles;
          return (
            <li key={s.t} className="flex flex-col items-center text-center">
              <span className="relative">
                <IconTile icon={Icon} size="lg" />
                <span className="absolute -right-2 -top-2 grid size-6 place-items-center rounded-full bg-white font-mono text-[11px] font-bold text-navy-800 shadow ring-2 ring-teal/40" aria-hidden>
                  {i + 1}
                </span>
              </span>
              <SpotCard dark={dark} className="mt-6 w-full text-left">
                <h3 className={cx("text-h3", dark ? "text-white" : "text-ink")}>{s.t}</h3>
                <p className={cx("mt-3 leading-relaxed", dark ? "text-slate-300" : "text-ink-soft")}>{s.d}</p>
              </SpotCard>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** A vertical rail of steps, for a dark side panel. */
export function StepRail({ steps, title = "How it works" }: { steps: Step[]; title?: string }) {
  return (
    <div className="band-dark grain relative overflow-hidden rounded-[1.75rem] p-7 sm:p-9">
      <div className="orb -right-20 -top-20 size-64 bg-teal/25" aria-hidden />
      <p className="eyebrow relative text-teal-glow">{title}</p>
      <div className="relative mt-8">
      <div className="beam beam-y absolute bottom-6 left-[1.2rem] top-6 w-px bg-white/15" aria-hidden />
      <ol className="relative space-y-8">
        {steps.map((s, i) => (
          <li key={s.t} className="relative grid grid-cols-[2.5rem_1fr] gap-5">
            <span className="ring-spin relative grid size-10 place-items-center rounded-full font-mono text-[13px] font-semibold text-white" style={{ animationDelay: `${i * -1.2}s` }} aria-hidden>
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <h3 className="text-[1.08rem] font-semibold tracking-tight text-white">{s.t}</h3>
              <p className="mt-1.5 text-[0.95rem] leading-relaxed text-slate-300">{s.d}</p>
            </div>
          </li>
        ))}
      </ol>
      </div>
    </div>
  );
}

/** A chain of stages joined by flowing arrows — how one thing becomes the next. */
export function FlowChain({ items, dark = false }: { items: { t: string; icon: LucideIcon }[]; dark?: boolean }) {
  return (
    <ol className="relative mt-14 flex flex-wrap items-stretch justify-center gap-y-6" aria-label="How the work flows">
      {items.map((it, i) => (
        <li key={it.t} className="flex items-center">
          <div
            data-tilt=""
            className={cx(
              "spot flex min-h-[8.75rem] w-[9.5rem] flex-col items-center justify-center gap-3 rounded-2xl px-3 py-5 text-center",
              dark ? "glass-dark" : "border border-mist-200 bg-white shadow-[0_18px_40px_-28px_rgb(8_41_87/0.5)]",
            )}
          >
            <IconTile icon={it.icon} />
            <span className={cx("text-[0.92rem] font-semibold leading-snug", dark ? "text-white" : "text-ink")}>{it.t}</span>
          </div>
          {i < items.length - 1 && (
            <svg className="mx-1 h-4 w-8 shrink-0 sm:w-10" viewBox="0 0 40 16" aria-hidden>
              <line x1="0" y1="8" x2="32" y2="8" stroke="#0fb4bb" strokeWidth="2" className="flow-dash" />
              <path d="M30 3l7 5-7 5" fill="none" stroke="#0fb4bb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </li>
      ))}
    </ol>
  );
}

/** One core with modules around it, wired by flowing lines. */
export function HubDiagram({ core, coreSub, modules }: { core: string; coreSub: string; modules: { t: string; icon: LucideIcon }[] }) {
  const n = modules.length;
  return (
    <div
      className="band-dark grain relative aspect-square w-full overflow-hidden rounded-[2rem] sm:aspect-[1.1]"
      role="img"
      aria-label={`Diagram: ${core} connected to ${modules.map((m) => m.t).join(", ")}.`}
    >
      <div className="absolute inset-0 grid-dots-dark opacity-60" aria-hidden />
      <div className="orb left-1/2 top-1/2 size-72 -translate-x-1/2 -translate-y-1/2 bg-teal/25" aria-hidden />
      <svg className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <circle cx="50" cy="50" r="36" fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
        {modules.map((m, i) => {
          const a = (i / n) * Math.PI * 2 - Math.PI / 2;
          return (
            <line
              key={m.t}
              x1="50"
              y1="50"
              x2={50 + Math.cos(a) * 36}
              y2={50 + Math.sin(a) * 36}
              stroke="#5fe0e4"
              strokeOpacity="0.55"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
              className="flow-dash"
              style={{ animationDelay: `${i * -0.2}s` }}
            />
          );
        })}
      </svg>
      <div className="ring-spin absolute left-1/2 top-1/2 grid size-32 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-center shadow-[0_0_60px_rgb(15_180_187/0.45)] sm:size-36">
        <div className="px-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-teal-glow">{core}</p>
          <p className="mt-1 text-[11px] leading-snug text-slate-300">{coreSub}</p>
        </div>
      </div>
      {modules.map((m, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const Icon = m.icon;
        return (
          <div
            key={m.t}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5"
            style={{ left: `${50 + Math.cos(a) * 36}%`, top: `${50 + Math.sin(a) * 36}%` }}
          >
            <span className="grid size-11 place-items-center rounded-2xl border border-teal/40 bg-navy-850 text-teal-glow shadow-[0_0_24px_rgb(15_180_187/0.35)] sm:size-12">
              <Icon className="size-5" strokeWidth={1.9} aria-hidden />
            </span>
            <span className="whitespace-nowrap rounded-full bg-navy-900/80 px-2 py-0.5 text-[11px] font-semibold text-white sm:text-[12px]">{m.t}</span>
          </div>
        );
      })}
    </div>
  );
}

/** FAQ as cards that open in place (plain <details>, works without JavaScript). */
export function FaqCards({ faqs }: { faqs: { q: string; a: string }[] }) {
  return (
    <div className="grid gap-3">
      {faqs.map(({ q, a }) => (
        <details key={q} className="faq spot group rounded-2xl border border-mist-200 bg-white px-6 py-5 transition-colors open:border-teal/40 open:shadow-[0_20px_50px_-30px_rgb(15_180_187/0.6)]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-left text-[1.06rem] font-semibold tracking-[-0.01em] text-ink">
            <h3>{q}</h3>
            <span
              className="grid size-8 shrink-0 place-items-center rounded-full border border-mist-300 text-teal-ink transition duration-300 group-open:rotate-45 group-open:border-teal group-open:bg-teal group-open:text-white"
              aria-hidden
            >
              +
            </span>
          </summary>
          <p className="mt-3 pr-12 text-[0.98rem] leading-relaxed text-ink-soft">{a}</p>
        </details>
      ))}
    </div>
  );
}

/** Feature links as lit cards with their icons. */
export function FeatureCards({
  slugs,
  dark = false,
  numbered = false,
  cta = "Explore",
}: {
  slugs?: FeatureSlug[];
  dark?: boolean;
  numbered?: boolean;
  cta?: string;
}) {
  const items = slugs ? slugs.map((s) => FEATURE_LINKS.find((l) => l.slug === s)!).filter(Boolean) : FEATURE_LINKS;
  return (
    <ul className={cx("grid gap-5 md:grid-cols-2", items.length % 3 === 0 && "lg:grid-cols-3")}>
      {items.map((f, i) => (
        <li key={f.slug}>
          <Link href={featurePath(f.slug)} className="group block h-full rounded-[1.6rem]">
            <SpotCard dark={dark} className="relative flex flex-col overflow-hidden">
              {numbered && (
                <span className="ghost-num absolute -right-1 -top-3 text-[5.5rem]" aria-hidden>
                  {String(i + 1).padStart(2, "0")}
                </span>
              )}
              <IconTile icon={FEATURE_ICON[f.slug]} />
              <span className={cx("text-h3 mt-6", dark ? "text-white" : "text-ink")}>{f.name}</span>
              <span className={cx("mt-3 flex-1 text-[0.97rem] leading-relaxed", dark ? "text-slate-400" : "text-ink-soft")}>{f.short}</span>
              <span className={cx("mt-6 inline-flex items-center gap-1.5 text-[0.9rem] font-semibold", dark ? "text-teal-glow" : "text-teal-ink")}>
                {cta} <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />
              </span>
            </SpotCard>
          </Link>
        </li>
      ))}
    </ul>
  );
}
