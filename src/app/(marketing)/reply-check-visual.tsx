import { CalendarClock, Check, CircleSlash, Gauge, MessageSquareText, Send } from "lucide-react";

/**
 * What happens between a patient's reply and an answer: the free text is read, a date
 * is pulled out of it, and the slot is put through the same checks a staff booking
 * goes through before anything is offered.
 *
 * This exists because the section's claim is the machinery, and machinery has to be
 * shown rather than asserted. The hero thread already shows the happy path from the
 * patient's side; this is the same exchange from the system's side.
 *
 * The rules named here are the real ones the booking validator applies — working
 * hours, leave, and the daily limit — not invented reassurance.
 *
 * Reuses the 9s `audit-in` keyframe rather than inventing another timing system, so
 * the steps arrive in order and cannot drift.
 */

const CHECKS = [
  { Icon: CalendarClock, label: "Within working hours", detail: "Thu 09:00 to 17:00" },
  { Icon: CircleSlash, label: "Not on leave", detail: "No leave booked" },
  { Icon: Gauge, label: "Under the daily limit", detail: "12 of 18 booked" },
];

export function ReplyCheckVisual({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" data-motion-scope className={`relative w-full select-none ${className ?? ""}`}>
      <div className="absolute inset-8 -z-10 bg-[radial-gradient(circle_at_50%_40%,var(--brand-teal)_0%,transparent_65%)] opacity-15 blur-2xl dark:opacity-25" />

      <div className="rounded-2xl bg-card/70 p-5 ring-1 ring-primary/20 backdrop-blur">
        {/* What the patient actually wrote. */}
        <div className="flex items-start gap-3">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06] text-muted-foreground ring-1 ring-foreground/10">
            <MessageSquareText className="size-4" />
          </span>
          <p className="rounded-2xl rounded-tl-sm bg-foreground/[0.06] px-3.5 py-2 text-xs leading-snug text-foreground/85 ring-1 ring-foreground/10">
            Can we do Thursday instead?
          </p>
        </div>

        {/* What was understood from it. */}
        <div
          style={{ animationDelay: "0.5s" }}
          className="mt-4 flex items-center justify-between rounded-xl bg-primary/[0.07] px-3.5 py-2.5 ring-1 ring-primary/20 motion-safe:animate-audit-in"
        >
          <span className="font-mono text-3xs tracking-widest text-muted-foreground uppercase">
            Read as
          </span>
          <span className="font-mono text-xs font-medium text-primary-text">
            Thu 4:30pm
          </span>
        </div>

        {/* The same checks a staff booking goes through. */}
        <ul className="mt-4 space-y-2">
          {CHECKS.map(({ Icon, label, detail }, i) => (
            <li
              key={label}
              style={{ animationDelay: `${(1.4 + i * 1).toFixed(1)}s` }}
              className="flex items-center gap-3 motion-safe:animate-audit-in"
            >
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-text ring-1 ring-primary/20">
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-foreground/80">{label}</span>
                <span className="block font-mono text-3xs text-muted-foreground">
                  {detail}
                </span>
              </span>
              <Check className="size-4 shrink-0 text-whatsapp-fg" />
            </li>
          ))}
        </ul>

        {/* Only now is anything promised to the patient. */}
        <div
          style={{ animationDelay: "4.8s" }}
          className="mt-4 flex items-center gap-2.5 rounded-xl bg-whatsapp/10 px-3.5 py-3 ring-1 ring-whatsapp/30 motion-safe:animate-audit-in"
        >
          <Send className="size-4 shrink-0 text-whatsapp-fg" />
          <p className="text-xs leading-snug text-foreground/85">
            <span className="font-medium">Only now is the slot offered.</span> Nothing is
            promised to a patient before it passes.
          </p>
        </div>
      </div>
    </div>
  );
}
