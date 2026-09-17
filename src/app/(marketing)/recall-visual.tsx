import { BellRing, CalendarCheck2, Check, NotebookPen } from "lucide-react";
import { WhatsAppIcon } from "./whatsapp-icon";

/**
 * A follow-up travelling from the end of one visit to the start of the next: noted,
 * scheduled, sent on WhatsApp, rebooked.
 *
 * Each step ARRIVES in order, which is honest here — these are events happening over
 * weeks, compressed. The connecting line fills as they land. Same 9s loop and
 * `audit-in` keyframes as the security artwork, staggered by delay.
 *
 * Specialty-agnostic: "a review", never a named procedure. Decorative; server-rendered.
 */

const STEPS = [
  { Icon: NotebookPen, title: "Next visit noted", detail: "\"Review in 6 months\" · today", tone: "teal" },
  { Icon: BellRing, title: "Reminder scheduled", detail: "One week before it is due", tone: "teal" },
  { Icon: WhatsAppIcon, title: "Sent on WhatsApp", detail: "Delivered and read", tone: "green" },
  { Icon: CalendarCheck2, title: "Patient rebooked", detail: "Thursday, 4:30pm", tone: "green" },
] as const;

export function RecallVisual({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" data-motion-scope className={`relative w-full select-none ${className ?? ""}`}>
      <div className="absolute inset-8 -z-10 bg-[radial-gradient(circle_at_50%_40%,var(--brand-teal)_0%,transparent_65%)] opacity-15 blur-2xl dark:opacity-25" />

      <div className="rounded-2xl bg-card/70 p-5 ring-1 ring-primary/20 backdrop-blur">
        <div className="flex items-center justify-between">
          <p className="font-mono text-2xs tracking-widest text-muted-foreground uppercase">Follow-up</p>
          <span className="rounded-full bg-card px-2.5 py-1 text-3xs font-medium tracking-wide text-primary-text uppercase ring-1 ring-primary/25">
            Automatic
          </span>
        </div>

        <ol className="relative mt-5 space-y-3">
          {/* The rail, and the fill running down it as each step lands. */}
          <span className="absolute top-5 bottom-5 left-[19px] w-px bg-foreground/10" />
          <span className="absolute top-5 bottom-5 left-[19px] w-px bg-gradient-to-b from-brand-teal to-whatsapp motion-safe:animate-trace-grow" />

          {STEPS.map(({ Icon, title, detail, tone }, i) => (
            <li
              key={title}
              style={{ animationDelay: `${(i * 1.1).toFixed(1)}s` }}
              className="relative flex items-center gap-3.5 rounded-xl bg-background/60 p-2.5 pr-4 ring-1 ring-foreground/5 motion-safe:animate-audit-in"
            >
              <span
                className={`relative inline-flex size-[38px] shrink-0 items-center justify-center rounded-full ring-1 ${
                  tone === "green"
                    ? "bg-whatsapp/12 text-whatsapp-fg ring-whatsapp/30"
                    : "bg-brand-teal/12 text-primary-text ring-primary/25"
                }`}
              >
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{title}</span>
                <span className="block truncate text-xs text-muted-foreground">{detail}</span>
              </span>
              {i === STEPS.length - 1 ? (
                <span className="inline-flex size-6 items-center justify-center rounded-full bg-whatsapp/15">
                  <Check className="size-3.5 text-whatsapp-fg" strokeWidth={3} />
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
