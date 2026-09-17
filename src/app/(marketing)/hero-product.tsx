import type { CSSProperties } from "react";
import {
  BarChart3,
  CalendarDays,
  Check,
  CheckCheck,
  LayoutDashboard,
  Mic,
  Receipt,
  Users,
} from "lucide-react";
import { WhatsAppIcon } from "./whatsapp-icon";
import { CountUp } from "./count-up";

/**
 * The homepage hero's product composition: the practice workspace in a browser frame,
 * with three moments from a real day floating around it — a note being drafted, a
 * reminder landing on WhatsApp, and money collected.
 *
 * It replaced an abstract hexagon illustration. That drawing was on-brand but said
 * nothing about the product; a visitor's first screen should show what they would
 * actually be using.
 *
 * Everything is illustrative. The names, times and amounts are a sample day, not a
 * customer's data, and no specialty vocabulary appears (CLAUDE.md §1).
 *
 * Motion, in order of appearance: the frame and cards rise in on load (`mk-rise`),
 * the revenue bars measure once, the note's status flips from Draft to Approved once,
 * then the cards bob slowly. Nothing loops its data. Layer wrappers carry the pointer
 * parallax (`hero-depth-*`), their children carry the entrance, and grandchildren the
 * float — one transform per element, so no animation overrides another.
 *
 * Server-rendered apart from the two count-ups; decorative, so hidden from assistive
 * tech (the hero copy beside it says the same thing in words).
 */

const delay = (ms: number) => ({ "--mk-delay": `${ms}ms` }) as CSSProperties;
const floatDelay = (s: number) => ({ "--mk-float-delay": `${s}s` }) as CSSProperties;

const QUEUE = [
  { token: 1, name: "Ayesha Khan", time: "10:00", who: "Dr. Sana", status: "Completed", tone: "done" },
  { token: 2, name: "Imran Qureshi", time: "10:30", who: "Dr. Sana", status: "Note to approve", tone: "draft" },
  { token: 3, name: "Fatima Noor", time: "11:00", who: "Dr. Ali", status: "With provider", tone: "active" },
  { token: 4, name: "Hamza Siddiqui", time: "11:15", who: "Dr. Sana", status: "Arrived", tone: "arrived" },
] as const;

const TONE = {
  done: "bg-success/12 text-success-text",
  draft: "bg-warning/15 text-warning-text",
  active: "bg-brand-teal/15 text-primary-text",
  arrived: "bg-info/12 text-info-text",
} as const;

const NAV_ICONS = [LayoutDashboard, CalendarDays, Users, Mic, Receipt, BarChart3];

const BARS = [42, 58, 50, 71, 64, 86, 78];

export function HeroProduct() {
  return (
    <div aria-hidden="true" className="relative select-none">
      {/* Light pooling under the frame. */}
      <div className="absolute inset-x-6 -bottom-10 -z-10 h-40 rounded-full bg-brand-teal/25 blur-3xl dark:bg-brand-teal/20" />

      {/* ---- the workspace ---- */}
      <div className="hero-depth-2">
        <div className="mk-rise mk-frame" style={delay(150)}>
          {/* Browser chrome. */}
          <div className="flex items-center gap-3 border-b border-[var(--mk-line)] bg-muted/60 px-4 py-2.5">
            <div className="flex gap-1.5">
              <span className="size-2.5 rounded-full bg-foreground/15" />
              <span className="size-2.5 rounded-full bg-foreground/15" />
              <span className="size-2.5 rounded-full bg-foreground/15" />
            </div>
            <div className="mx-auto flex h-6 w-full max-w-60 items-center justify-center rounded-md bg-background/80 font-mono text-3xs text-muted-foreground shadow-[0_0_0_1px_var(--mk-line)]">
              app.flexicaai.com
            </div>
            <span className="size-5 rounded-full bg-gradient-to-br from-brand-teal to-brand-navy" />
          </div>

          <div className="grid grid-cols-[44px_1fr] sm:grid-cols-[52px_1fr]">
            {/* Icon rail. */}
            <div className="flex flex-col items-center gap-2 border-r border-[var(--mk-line)] py-4">
              {NAV_ICONS.map((Icon, i) => (
                <span
                  key={i}
                  className={`inline-flex size-8 items-center justify-center rounded-lg ${
                    i === 0 ? "bg-brand-teal/15 text-primary-text" : "text-muted-foreground/70"
                  }`}
                >
                  <Icon className="size-4" />
                </span>
              ))}
            </div>

            <div className="min-w-0 p-4 sm:p-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-2xs text-muted-foreground">Wednesday, 17 September</p>
                  <p className="text-lg font-semibold tracking-tight">Today</p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success/12 px-2.5 py-1 text-3xs font-semibold text-success-text">
                  <span className="relative inline-flex size-1.5">
                    <span className="absolute inset-0 rounded-full bg-success motion-safe:animate-ping-ring" />
                    <span className="relative size-1.5 rounded-full bg-success" />
                  </span>
                  Live queue
                </span>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
                {[
                  { label: "Appointments", value: "18" },
                  { label: "Waiting now", value: "3" },
                  { label: "Recalls due", value: "5" },
                ].map((k, i) => (
                  <div
                    key={k.label}
                    className="mk-rise rounded-xl bg-muted/60 px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--mk-line)]"
                    style={delay(450 + i * 80)}
                  >
                    <p className="truncate text-3xs text-muted-foreground">{k.label}</p>
                    <p className="text-xl font-semibold tracking-tight tabular-nums">{k.value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 overflow-hidden rounded-xl shadow-[inset_0_0_0_1px_var(--mk-line)]">
                {QUEUE.map((row, i) => (
                  <div
                    key={row.token}
                    className="mk-rise grid grid-cols-[22px_1fr_auto] items-center gap-2.5 border-t border-[var(--mk-line)] px-3 py-2.5 first:border-t-0 sm:grid-cols-[22px_1fr_44px_auto]"
                    style={delay(650 + i * 90)}
                  >
                    <span className="font-mono text-2xs font-semibold text-muted-foreground">#{row.token}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">{row.name}</span>
                      <span className="block truncate text-3xs text-muted-foreground">{row.who}</span>
                    </span>
                    <span className="hidden font-mono text-2xs text-muted-foreground sm:block">{row.time}</span>
                    <span className={`justify-self-end rounded-full px-2 py-0.5 text-3xs font-semibold whitespace-nowrap ${TONE[row.tone]}`}>
                      {row.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---- floating: the note being drafted ---- */}
      <div className="hero-depth-3 absolute -top-20 left-0 w-48 sm:top-[56%] sm:-left-14 sm:w-56">
        <div className="mk-rise" style={delay(700)}>
          <div className="mk-float mk-card rounded-2xl p-3.5" style={floatDelay(0)}>
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 text-2xs font-semibold">
                <span className="inline-flex size-6 items-center justify-center rounded-full bg-brand-teal/15 text-primary-text">
                  <Mic className="size-3.5" />
                </span>
                AI note
              </span>
              <span className="relative inline-flex h-5 items-center">
                <span
                  className="mk-swap-out rounded-full bg-warning/15 px-2 py-0.5 text-3xs font-semibold text-warning-text"
                  style={delay(2600)}
                >
                  Draft
                </span>
                <span
                  className="mk-swap-in absolute right-0 inline-flex items-center gap-1 rounded-full bg-success/12 px-2 py-0.5 text-3xs font-semibold whitespace-nowrap text-success-text"
                  style={delay(2750)}
                >
                  <Check className="size-2.5" strokeWidth={3} />
                  Approved
                </span>
              </span>
            </div>
            <div className="mt-3 flex h-5 items-center gap-[3px]">
              {[40, 70, 35, 90, 55, 100, 45, 80, 30, 65, 50, 85, 38, 60].map((h, i) => (
                <span
                  key={i}
                  style={{ height: `${h}%`, animationDelay: `${(i % 7) * 0.12}s` }}
                  className="w-[3px] rounded-full bg-brand-teal/70 motion-safe:animate-wave-bar"
                />
              ))}
            </div>
            <dl className="mt-3 space-y-1.5 text-3xs leading-snug">
              {[
                ["Complaint", "Discomfort for a week"],
                ["Plan", "Short course, rest advised"],
                ["Follow-up", "Review in 10 days"],
              ].map(([k, v], i) => (
                <div key={k} className="mk-rise flex gap-2" style={delay(1300 + i * 350)}>
                  <dt className="w-14 shrink-0 text-muted-foreground">{k}</dt>
                  <dd className="text-foreground/85">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>

      {/* ---- floating: the reminder on WhatsApp ---- */}
      <div className="hero-depth-1 absolute -bottom-16 right-2 w-56 sm:-right-6 sm:-bottom-14 sm:w-64">
        <div className="mk-rise" style={delay(1000)}>
          <div className="mk-float mk-card rounded-2xl p-3.5" style={floatDelay(1.6)}>
            <div className="flex items-center gap-2">
              <span className="inline-flex size-7 items-center justify-center rounded-full bg-whatsapp/15 text-whatsapp-fg">
                <WhatsAppIcon className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-2xs font-semibold">Reminder sent</p>
                <p className="text-3xs text-muted-foreground">to Hamza · automatically</p>
              </div>
            </div>
            <p className="mt-2.5 rounded-xl rounded-tl-sm bg-whatsapp/12 px-3 py-2 text-2xs leading-snug text-foreground/85">
              See you tomorrow at 4:30pm. Reply to reschedule.
              <span className="mt-1 flex items-center justify-end gap-1 text-3xs text-muted-foreground">
                18:02 <CheckCheck className="size-3 text-[#34b7f1]" />
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* ---- floating: money collected ---- */}
      <div className="hero-depth-3 absolute -top-12 -right-2 hidden w-48 sm:block lg:-right-8">
        <div className="mk-rise" style={delay(1250)}>
          <div className="mk-float mk-card rounded-2xl p-3.5" style={floatDelay(3.1)}>
            <p className="text-3xs font-medium text-muted-foreground">Collected this week</p>
            <p className="mt-0.5 text-lg font-semibold tracking-tight">
              <CountUp value={384200} prefix="Rs " delay={900} />
            </p>
            <div className="mt-2.5 flex h-12 items-end gap-1.5">
              {BARS.map((h, i) => (
                <span
                  key={i}
                  className="mk-grow flex-1 rounded-t-[4px] bg-gradient-to-t from-brand-blue/35 to-brand-teal"
                  style={{ height: `${h}%`, ...delay(1500 + i * 70) }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
