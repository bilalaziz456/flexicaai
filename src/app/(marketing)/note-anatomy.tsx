import type { ComponentType } from "react";
import { BellRing, ClipboardList, Pill, ShieldCheck, Stethoscope } from "lucide-react";
import { AiBadge } from "./ai-kit";

/**
 * "Every phrase lands where it belongs": what the provider SAID on the left, what the
 * note RECORDS on the right, and the line between them drawing itself as the row
 * scrolls into view — the understanding step, slowed down enough to read.
 *
 * Each row also names what happens BECAUSE of that field (a formulary check, an
 * allergy cross-check, a reminder), since that is where the note stops being text and
 * starts doing work. Every one of those is a real behaviour of the scribe
 * (`.claude/ai-scribe.md` §1). Specialty-agnostic sample content.
 */

type Row = {
  said: string;
  Icon: ComponentType<{ className?: string }>;
  field: string;
  value: string;
  then?: string;
  tone?: "ok" | "warn";
};

const ROWS: Row[] = [
  {
    said: "“The pain has eased over the week, mostly gone in the mornings.”",
    Icon: ClipboardList,
    field: "Complaint",
    value: "Follow-up. Pain easing over one week.",
  },
  {
    said: "“Healing well, no swelling, no sign of infection.”",
    Icon: Stethoscope,
    field: "Findings",
    value: "Healing well. No swelling or signs of infection.",
  },
  {
    said: "“Continue paracetamol, five hundred, twice a day.”",
    Icon: Pill,
    field: "Prescription",
    value: "Paracetamol 500 mg · twice daily · 5 days",
    then: "Checked against your formulary and the patient’s recorded allergies",
    tone: "ok",
  },
  {
    said: "“…five hundred…” (partly inaudible)",
    Icon: ShieldCheck,
    field: "Flag",
    value: "Dose was unclear in the audio — confirm before approving",
    then: "Flagged for the provider, never guessed",
    tone: "warn",
  },
  {
    said: "“Let’s see him again in ten days.”",
    Icon: BellRing,
    field: "Follow-up",
    value: "Review in 10 days",
    then: "A WhatsApp reminder is scheduled once the note is approved",
    tone: "ok",
  },
];

export function NoteAnatomy() {
  return (
    <ol className="space-y-4 sm:space-y-5">
      {ROWS.map(({ said, Icon, field, value, then, tone }, i) => (
        <li
          key={field}
          className="reveal-up grid items-center gap-3 lg:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1.1fr)] lg:gap-0"
        >
          {/* What was said. */}
          <p className="rounded-2xl border border-dashed border-[var(--mk-line-strong)] px-5 py-4 text-[0.98rem] leading-relaxed text-foreground/80 italic">
            {said}
          </p>

          {/* The connector: a line that draws on scroll, with the model at its centre. */}
          <div aria-hidden="true" className="relative flex h-10 items-center justify-center lg:h-full">
            <svg className="absolute inset-0 hidden h-full w-full lg:block" preserveAspectRatio="none" viewBox="0 0 100 10" fill="none">
              <path
                d="M0 5 H100"
                pathLength={1}
                stroke="var(--brand-teal)"
                strokeOpacity="0.6"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
                strokeDasharray="1"
                className="mk-draw"
              />
            </svg>
            <span className="absolute inset-y-0 left-1/2 w-px bg-gradient-to-b from-transparent via-brand-teal/60 to-transparent lg:hidden" />
            <span
              className="relative inline-flex size-8 items-center justify-center rounded-full bg-background shadow-[0_0_0_1px_color-mix(in_oklab,var(--brand-teal)_40%,transparent),0_0_24px_-4px_var(--brand-teal)]"
              style={{ animationDelay: `${i * 0.3}s` }}
            >
              <span className="mk-breathe absolute inset-1 rounded-full bg-brand-teal/20" />
              <svg viewBox="0 0 24 24" className="relative size-4 text-primary-text" fill="currentColor">
                <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2zm7 11l.9 2.6L22.5 16.5l-2.6.9L19 20l-.9-2.6-2.6-.9 2.6-.9L19 13z" />
              </svg>
            </span>
          </div>

          {/* What the note records. */}
          <div
            className={`mk-card rounded-2xl px-5 py-4 ${tone === "warn" ? "shadow-[0_0_0_1px_color-mix(in_oklab,var(--warning)_45%,transparent),var(--mk-shadow)]" : ""}`}
          >
            <div className="flex items-center gap-2.5">
              <span
                className={`inline-flex size-8 items-center justify-center rounded-xl ${
                  tone === "warn" ? "bg-warning/15 text-warning-text" : "bg-brand-teal/12 text-primary-text"
                }`}
              >
                <Icon className="size-4" />
              </span>
              <span className="text-xs font-semibold tracking-[0.1em] text-muted-foreground uppercase">{field}</span>
              {i === 0 ? <AiBadge className="ml-auto">Extracted</AiBadge> : null}
            </div>
            <p className={`mt-2.5 font-semibold tracking-[-0.01em] ${field === "Prescription" ? "font-mono text-[0.92rem]" : ""}`}>{value}</p>
            {then ? (
              <p className={`mt-1.5 text-sm ${tone === "warn" ? "text-warning-text" : "text-muted-foreground"}`}>↳ {then}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
