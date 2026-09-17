import type { CSSProperties } from "react";
import { AlertTriangle, AudioLines, Check, FileText, Mic, Sparkles } from "lucide-react";
import { PhaseLoop } from "./phase-loop";

/**
 * The AI scribe hero's right-hand composition, in the homepage hero's language: one
 * product surface (the note) with two moments floating around it — the recording, and
 * the model at work. The full three-panel studio is the section below; this is the
 * glance.
 *
 * Phases, the product's real order:
 *   0 recording     — waveform live, the note is empty
 *   1 understanding — the key phrases light up, what they are is lifted out
 *   2 drafting      — the note's fields write themselves
 *   3 draft ready   — DRAFT, with the unclear dose flagged. Never shown as approved:
 *                     approval is the provider's act, not the AI's.
 *
 * Layers carry the pointer parallax (`hero-depth-*`); the phase attributes sit on
 * elements inside them, so no transform fights another. On a phone the floating cards
 * stack above and below the note instead of overlapping it.
 */

const DURATIONS = [3000, 2600, 3200, 5200];

const d = (ms: number) => ({ "--d": ms }) as CSSProperties;

const WAVE = [34, 60, 40, 84, 55, 100, 46, 72, 36, 88, 58, 30, 66, 44, 80, 50, 32, 62];

const FIELDS = [
  { label: "Complaint", value: "Follow-up. Pain easing over one week." },
  { label: "Findings", value: "Healing well. No swelling or signs of infection." },
  { label: "Prescription", value: "Paracetamol 500 mg · twice daily · 5 days", mono: true },
  { label: "Follow-up", value: "Review in 10 days · reminder scheduled" },
];

export function ScribeHeroArt() {
  return (
    <PhaseLoop durations={DURATIONS}>
      <div aria-hidden="true" className="relative select-none sm:pt-44 sm:pb-20 sm:pl-10">
        {/* ---- floating: the recording ---- */}
        <div className="hero-depth-3 relative mb-4 sm:absolute sm:top-0 sm:-left-6 sm:z-10 sm:mb-0 sm:w-64 lg:-left-12">
          <div className="mk-card rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 text-xs font-semibold">
                <span className="inline-flex size-7 items-center justify-center rounded-full bg-destructive/10 text-destructive-text">
                  <Mic className="size-3.5" />
                </span>
                Consultation
              </span>
              <span className="grid">
                <span data-only="0" className="col-start-1 row-start-1 inline-flex items-center gap-1.5 justify-self-end text-3xs font-semibold text-destructive-text">
                  <span className="size-1.5 rounded-full bg-destructive motion-safe:animate-pulse" /> REC 02:14
                </span>
                <span data-from="1" className="col-start-1 row-start-1 justify-self-end font-mono text-3xs text-muted-foreground">
                  02:14 · saved
                </span>
              </span>
            </div>
            <div className="mt-3 grid h-8">
              <div data-upto="0" className="col-start-1 row-start-1 flex items-center gap-[3px]">
                {WAVE.map((h, i) => (
                  <span
                    key={i}
                    className="w-full rounded-full bg-gradient-to-t from-brand-blue to-brand-teal motion-safe:animate-wave-bar"
                    style={{ height: `${h}%`, animationDelay: `${(i % 7) * 0.11}s` }}
                  />
                ))}
              </div>
              <div data-from="1" className="col-start-1 row-start-1 flex items-center gap-[3px]">
                {WAVE.map((h, i) => (
                  <span key={i} className="w-full rounded-full bg-foreground/15" style={{ height: `${Math.max(14, h * 0.35)}%` }} />
                ))}
              </div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-foreground/80">
              “<mark className="mk-hl-early rounded bg-transparent px-0.5 text-inherit transition-colors duration-700">The pain has eased</mark>… continue paracetamol,{" "}
              <span className="mk-flag-early rounded px-0.5 transition-colors duration-700">five hundred…</span>{" "}
              <mark className="mk-hl-early rounded bg-transparent px-0.5 text-inherit transition-colors duration-700">see him in ten days</mark>.”
            </p>
          </div>
        </div>

        {/* ---- the note ---- */}
        <div className="hero-depth-2">
          <div className="mk-frame rounded-3xl text-left">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--mk-line)] px-5 py-3.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-teal/12 text-primary-text">
                  <FileText className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">Clinical note</span>
                  <span className="block truncate text-2xs text-muted-foreground">Imran Qureshi · Dr. Sana</span>
                </span>
              </div>
              <span className="grid">
                <span data-upto="1" className="col-start-1 row-start-1 justify-self-end rounded-full bg-foreground/[0.06] px-2.5 py-1 text-3xs font-semibold text-muted-foreground">
                  Waiting
                </span>
                <span data-only="2" className="col-start-1 row-start-1 inline-flex items-center gap-1 justify-self-end rounded-full bg-brand-teal/12 px-2.5 py-1 text-3xs font-semibold text-primary-text">
                  <Sparkles className="size-3" /> <span className="mk-shimmer">Writing</span>
                </span>
                <span data-from="3" className="col-start-1 row-start-1 justify-self-end rounded-full bg-warning/15 px-2.5 py-1 text-3xs font-semibold tracking-wide text-warning-text uppercase">
                  Draft
                </span>
              </span>
            </div>

            <dl className="space-y-3 px-5 py-4">
              {FIELDS.map((field, i) => (
                <div key={field.label} className="grid grid-cols-[5.5rem_1fr] items-start gap-3 border-b border-[var(--mk-line)] pb-3 last:border-0 last:pb-0">
                  <dt className="pt-0.5 text-2xs font-medium text-muted-foreground">{field.label}</dt>
                  <dd className="grid min-w-0 text-[0.8rem] leading-snug">
                    <span data-upto="1" className="col-start-1 row-start-1 mt-1.5 h-2 w-4/5 rounded-full bg-foreground/[0.06]" />
                    <span data-only="2" className="mk-skeleton col-start-1 row-start-1 mt-1.5 h-2" style={{ width: `${86 - i * 10}%` }} />
                    <span
                      data-from="2"
                      className={`col-start-1 row-start-1 text-foreground ${field.mono ? "font-mono text-[0.72rem]" : ""}`}
                      style={d(200 + i * 600)}
                    >
                      {field.value}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>

            <div className="px-5 pb-5">
              <div className="grid">
                <div data-upto="2" className="col-start-1 row-start-1 flex items-center gap-2 rounded-xl bg-muted/70 px-3 py-2.5 text-2xs text-muted-foreground">
                  <Check className="size-3.5" /> Checked against your formulary
                </div>
                <div data-from="3" style={d(200)} className="col-start-1 row-start-1 flex items-start gap-2 rounded-xl bg-warning/10 px-3 py-2.5 text-2xs leading-snug">
                  <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning-text" />
                  <span>
                    <span className="font-semibold text-warning-text">Check the dose.</span>{" "}
                    <span className="text-foreground/80">The audio was unclear — confirm 500 mg.</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ---- floating: the model at work ---- */}
        <div className="hero-depth-1 relative mt-4 sm:absolute sm:-right-4 sm:bottom-0 sm:mt-0 sm:w-60 lg:-right-10">
          <div className="mk-card flex items-center gap-3.5 rounded-2xl p-4">
            <span className="relative grid size-12 shrink-0 place-items-center">
              <span
                className="mk-orbit absolute inset-0 rounded-full [mask:radial-gradient(farthest-side,transparent_calc(100%-2.5px),black_calc(100%-2px))]"
                style={{ background: "conic-gradient(from 0deg, transparent 0 50%, var(--brand-teal) 80%, var(--brand-blue) 95%, transparent)", "--mk-orbit": "4s" } as CSSProperties}
              />
              <span className="inline-flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-teal to-brand-blue text-brand-navy shadow-[0_0_24px_-4px_var(--brand-teal)]">
                <Sparkles className="size-4" />
              </span>
            </span>
            <span className="grid min-w-0 flex-1">
              <span data-only="0" className="col-start-1 row-start-1">
                <span className="flex items-center gap-1.5 text-xs font-semibold">
                  <AudioLines className="size-3.5 text-primary-text" /> <span className="mk-shimmer">Listening</span>
                </span>
                <span className="mt-0.5 block text-3xs text-muted-foreground">Recording the consultation</span>
              </span>
              <span data-only="1" className="col-start-1 row-start-1">
                <span className="mk-shimmer block text-xs font-semibold">Understanding</span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {["Complaint", "Medication", "Follow-up"].map((c, i) => (
                    <span key={c} data-from="1" style={d(150 + i * 160)} className="rounded-full bg-brand-teal/12 px-1.5 py-0.5 text-3xs font-semibold text-primary-text">
                      {c}
                    </span>
                  ))}
                </span>
              </span>
              <span data-only="2" className="col-start-1 row-start-1">
                <span className="mk-shimmer block text-xs font-semibold">Writing the note</span>
                <span className="mt-0.5 block text-3xs text-muted-foreground">Structured, field by field</span>
              </span>
              <span data-only="3" className="col-start-1 row-start-1">
                <span className="flex items-center gap-1.5 text-xs font-semibold">
                  <Check className="size-3.5 text-success-text" strokeWidth={3} /> Draft ready
                </span>
                <span className="mt-0.5 block text-3xs text-muted-foreground">Waiting for Dr. Sana to approve</span>
              </span>
            </span>
          </div>
        </div>
      </div>
    </PhaseLoop>
  );
}
