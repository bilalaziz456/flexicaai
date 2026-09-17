import type { CSSProperties, ReactNode } from "react";
import { AlertTriangle, AudioLines, BadgeCheck, Check, FileText, Mic, RotateCw, Sparkles } from "lucide-react";
import { PhaseLoop } from "./phase-loop";

/**
 * The AI scribe page's hero composition: a consultation becoming a clinical note, as
 * ONE connected scene — voice on the left, the model working in the middle, the note
 * assembling on the right, with light running between them while work is in flight.
 *
 * The phases are the product's real states, in order:
 *   0 recording    — the provider talks; the waveform is live
 *   1 transcribing — the words arrive
 *   2 understanding— the clinically relevant phrases light up, and what they are
 *                    (complaint, findings, medication, follow-up) is lifted out
 *   3 drafting     — the fields of the note are written
 *   4 draft ready  — a DRAFT, with the one thing the audio left unclear flagged for
 *                    the provider. It is never shown as approved here: approval is the
 *                    provider's act, and the scene stops at the point the AI's job ends.
 *
 * Deliberately NOT shown: speaker labels (the transcription does not separate voices)
 * and confidence percentages (the product flags what is unclear; it does not print a
 * score). An illustration that promised either would be promising a feature.
 *
 * Specialty-agnostic content (CLAUDE.md §1). Decorative; the page copy says it in words.
 */

const DURATIONS = [3200, 3600, 2800, 3400, 5200];

const d = (ms: number) => ({ "--d": ms }) as CSSProperties;

/** Transcript, as phrases. `hl` marks what the model lifts out; `flag` the unclear bit. */
const TRANSCRIPT: { text: string; hl?: string; flag?: boolean }[][] = [
  [{ text: "Back for a follow-up. " }, { text: "The pain has eased over the week,", hl: "Complaint" }, { text: " mostly gone in the mornings." }],
  [{ text: "On examination it's " }, { text: "healing well, no swelling, no sign of infection.", hl: "Findings" }],
  [{ text: "Continue paracetamol, " }, { text: "five hundred…", flag: true }, { text: " " }, { text: "twice a day for five more days.", hl: "Medication" }],
  [{ text: "Let's " }, { text: "see him again in ten days.", hl: "Follow-up" }],
];

const WAVE = [30, 55, 38, 80, 62, 100, 48, 72, 35, 90, 58, 26, 68, 44, 84, 52, 30, 64, 40, 76, 50, 92, 36, 60];

const STAGES = ["Listening", "Transcribing", "Understanding context", "Writing the note"];

const FIELDS: { label: string; value: ReactNode }[] = [
  { label: "Complaint", value: "Follow-up. Pain easing over one week." },
  { label: "Findings", value: "Healing well. No swelling or signs of infection." },
  { label: "Plan", value: "Continue current course for 5 days." },
  {
    label: "Prescription",
    value: (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-[0.8rem]">Paracetamol 500 mg · twice daily · 5 days</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-success/12 px-1.5 py-0.5 text-3xs font-semibold text-success-text">
          <Check className="size-2.5" strokeWidth={3} /> Formulary
        </span>
      </span>
    ),
  },
  {
    label: "Follow-up",
    value: (
      <span className="inline-flex flex-wrap items-center gap-2">
        Review in 10 days
        <span className="rounded-full bg-brand-teal/12 px-1.5 py-0.5 text-3xs font-semibold text-primary-text">Reminder scheduled</span>
      </span>
    ),
  },
];

/** The status pill in the studio's top bar, one per phase, stacked in one cell. */
function Status() {
  const pill = "col-start-1 row-start-1 inline-flex items-center gap-2 justify-self-end rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap";
  return (
    <span className="grid">
      <span data-only="0" className={`${pill} bg-destructive/10 text-destructive-text`}>
        <span className="size-2 rounded-full bg-destructive motion-safe:animate-pulse" /> Recording · 02:14
      </span>
      <span data-only="1" className={`${pill} bg-brand-teal/12 text-primary-text`}>
        <AudioLines className="size-3.5" /> <span className="mk-shimmer">Transcribing</span>
      </span>
      <span data-only="2" className={`${pill} bg-brand-teal/12 text-primary-text`}>
        <Sparkles className="size-3.5" /> <span className="mk-shimmer">Understanding</span>
      </span>
      <span data-only="3" className={`${pill} bg-brand-teal/12 text-primary-text`}>
        <Sparkles className="size-3.5" /> <span className="mk-shimmer">Drafting note</span>
      </span>
      <span data-only="4" className={`${pill} bg-warning/15 text-warning-text`}>
        <FileText className="size-3.5" /> Draft ready for review
      </span>
    </span>
  );
}

function Panel({ title, icon, children, className }: { title: string; icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`relative flex min-w-0 flex-col rounded-3xl bg-card/80 p-5 shadow-[0_0_0_1px_var(--mk-line),var(--mk-shadow)] backdrop-blur sm:p-6 ${className ?? ""}`}>
      <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        {icon}
        {title}
      </p>
      {children}
    </div>
  );
}

/** The light running between two panels while work is in flight (phases 1-3). */
function Flow({ vertical = false, delay = 0 }: { vertical?: boolean; delay?: number }) {
  return vertical ? (
    <div aria-hidden="true" className="flex h-10 justify-center lg:hidden">
      <span data-from="1" className="mk-beam mk-beam-y h-full w-px" style={{ "--mk-beam-delay": `${delay}s` } as CSSProperties} />
    </div>
  ) : (
    <div aria-hidden="true" className="hidden items-center lg:flex">
      <span className="mk-beam h-px w-full" style={{ "--mk-beam-delay": `${delay}s` } as CSSProperties} />
    </div>
  );
}

export function ScribeStudio() {
  return (
    <PhaseLoop durations={DURATIONS}>
      <div aria-hidden="true" className="mk-frame relative overflow-hidden rounded-[2rem] bg-card/60 backdrop-blur-xl">
        {/* Studio top bar. */}
        <div className="flex items-center justify-between gap-4 border-b border-[var(--mk-line)] px-5 py-3.5 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-teal to-brand-blue text-sm font-semibold text-brand-navy">
              IQ
            </span>
            <div className="min-w-0 text-left">
              <p className="truncate text-sm font-semibold">Imran Qureshi · Follow-up</p>
              <p className="truncate text-xs text-muted-foreground">Dr. Sana · Wednesday, 17 September</p>
            </div>
          </div>
          <Status />
        </div>

        <div className="grid gap-0 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_3rem_minmax(0,0.72fr)_3rem_minmax(0,1.08fr)] lg:gap-0">
          {/* ---- 1. voice ---- */}
          <Panel title="Consultation" icon={<Mic className="size-3.5" />}>
            {/* Live waveform while recording/transcribing; a settled trace afterwards. */}
            <div className="mt-4 grid h-14">
              <div data-upto="1" className="col-start-1 row-start-1 flex items-center gap-[3px]">
                {WAVE.map((h, i) => (
                  <span
                    key={i}
                    className="w-full rounded-full bg-gradient-to-t from-brand-blue to-brand-teal motion-safe:animate-wave-bar"
                    style={{ height: `${h}%`, animationDelay: `${(i % 8) * 0.11}s` }}
                  />
                ))}
              </div>
              <div data-from="2" className="col-start-1 row-start-1 flex items-center gap-[3px]">
                {WAVE.map((h, i) => (
                  <span key={i} className="w-full rounded-full bg-foreground/15" style={{ height: `${Math.max(12, h * 0.35)}%` }} />
                ))}
              </div>
            </div>

            <div className="mt-5 mb-6 space-y-2.5 text-left text-[0.92rem] leading-relaxed text-foreground/85">
              {TRANSCRIPT.map((line, i) => (
                <p key={i} data-from="1" style={d(i * 520)}>
                  {line.map((part, j) =>
                    part.hl ? (
                      <mark key={j} className="mk-hl rounded bg-transparent px-0.5 text-inherit transition-colors duration-700">
                        {part.text}
                      </mark>
                    ) : part.flag ? (
                      <span key={j} className="mk-flag rounded px-0.5 transition-colors duration-700">
                        {part.text}
                      </span>
                    ) : (
                      <span key={j}>{part.text}</span>
                    ),
                  )}
                </p>
              ))}
            </div>

            {/* The recording itself, kept with the visit. */}
            <div className="mt-auto flex items-center gap-3 rounded-2xl bg-muted/70 px-3.5 py-3 pt-3">
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground/[0.07] text-foreground/70">
                <Mic className="size-4" />
              </span>
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/10">
                <span className="block h-full w-2/3 rounded-full bg-gradient-to-r from-brand-teal to-brand-blue" />
              </span>
              <span className="font-mono text-2xs text-muted-foreground">02:14</span>
            </div>
          </Panel>

          <Flow delay={0} />
          <Flow vertical delay={0} />

          {/* ---- 2. the model ---- */}
          <Panel title="FlexicaAI" icon={<Sparkles className="size-3.5 text-primary-text" />} className="items-center">
            <div className="relative my-auto grid size-40 place-items-center pt-6">
              {/* Conic ring, slowly turning. */}
              <span
                className="mk-orbit absolute inset-0 rounded-full opacity-80 [mask:radial-gradient(farthest-side,transparent_calc(100%-3px),black_calc(100%-2px))]"
                style={{ background: "conic-gradient(from 0deg, transparent 0 55%, var(--brand-teal) 80%, var(--brand-blue) 95%, transparent)" }}
              />
              <span
                className="mk-orbit absolute inset-4 rounded-full opacity-50 [mask:radial-gradient(farthest-side,transparent_calc(100%-2px),black_calc(100%-1px))]"
                style={{ background: "conic-gradient(from 180deg, transparent 0 60%, var(--brand-blue) 85%, transparent)", "--mk-orbit": "9s" } as CSSProperties}
              />
              <span className="mk-breathe absolute inset-9 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--brand-teal)_55%,transparent),transparent_70%)] blur-md" />
              <span className="relative inline-flex size-16 items-center justify-center rounded-full bg-gradient-to-br from-brand-teal to-brand-blue text-brand-navy shadow-[0_0_40px_-4px_var(--brand-teal)]">
                <Sparkles className="size-7" />
              </span>
            </div>

            {/* Stages: pending, active or done — three states per row, one cell each. */}
            <ul className="mt-7 w-full space-y-2.5 text-left text-sm">
              {STAGES.map((stage, i) => (
                <li key={stage} className="flex items-center gap-3">
                  <span className="grid size-5 shrink-0">
                    {i > 0 ? (
                      <span data-upto={String(i - 1)} className="col-start-1 row-start-1 size-5 rounded-full shadow-[inset_0_0_0_1.5px_var(--mk-line-strong)]" />
                    ) : null}
                    <span data-only={String(i)} className="col-start-1 row-start-1 inline-flex size-5 items-center justify-center">
                      <span className="size-5 rounded-full border-2 border-brand-teal/25 border-t-brand-teal motion-safe:animate-spin" />
                    </span>
                    <span data-from={String(i + 1)} className="col-start-1 row-start-1 inline-flex size-5 items-center justify-center rounded-full bg-brand-teal text-brand-navy">
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                  </span>
                  <span className="grid">
                    <span data-only={String(i)} className="col-start-1 row-start-1 mk-shimmer font-semibold text-foreground">
                      {stage}
                    </span>
                    {i > 0 ? (
                      <span data-upto={String(i - 1)} className="col-start-1 row-start-1 text-muted-foreground/70">
                        {stage}
                      </span>
                    ) : null}
                    <span data-from={String(i + 1)} className="col-start-1 row-start-1 text-foreground/80">
                      {stage}
                    </span>
                  </span>
                </li>
              ))}
            </ul>

            {/* What was lifted out of the conversation. */}
            <div className="mt-6 mb-auto flex flex-wrap justify-center gap-1.5 pt-2">
              {["Complaint", "Findings", "Medication", "Follow-up"].map((chip, i) => (
                <span
                  key={chip}
                  data-from="2"
                  style={d(200 + i * 160)}
                  className="rounded-full bg-brand-teal/10 px-2.5 py-1 text-3xs font-semibold text-primary-text shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--brand-teal)_25%,transparent)]"
                >
                  {chip}
                </span>
              ))}
            </div>
          </Panel>

          <Flow delay={0.6} />
          <Flow vertical delay={0.6} />

          {/* ---- 3. the note ---- */}
          <Panel title="Clinical note" icon={<FileText className="size-3.5" />}>
            <div className="absolute top-4 right-5 grid sm:top-5 sm:right-6">
              <span data-upto="3" className="col-start-1 row-start-1 justify-self-end rounded-full bg-foreground/[0.06] px-2.5 py-1 text-3xs font-semibold text-muted-foreground">
                Waiting
              </span>
              <span data-from="4" className="col-start-1 row-start-1 justify-self-end rounded-full bg-warning/15 px-2.5 py-1 text-3xs font-semibold tracking-wide text-warning-text uppercase">
                Draft
              </span>
            </div>

            <dl className="mt-5 space-y-3.5 text-left">
              {FIELDS.map((field, i) => (
                <div key={field.label} className="grid grid-cols-[6.5rem_1fr] items-start gap-3 border-b border-[var(--mk-line)] pb-3.5 last:border-0 last:pb-0">
                  <dt className="pt-0.5 text-xs font-medium text-muted-foreground">{field.label}</dt>
                  <dd className="grid min-w-0 text-sm leading-snug">
                    <span data-upto="2" className="col-start-1 row-start-1 mt-1.5 h-2.5 w-4/5 rounded-full bg-foreground/[0.06]" />
                    <span data-only="3" className="mk-skeleton col-start-1 row-start-1 mt-1.5 h-2.5" style={{ width: `${88 - i * 9}%` }} />
                    <span data-from="3" className="col-start-1 row-start-1 text-foreground" style={d(250 + i * 520)}>
                      {field.value}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>

            <div data-from="4" style={d(200)} className="mt-4 flex items-start gap-2.5 rounded-2xl bg-warning/10 px-3.5 py-3 text-left text-xs leading-snug">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-text" />
              <span>
                <span className="font-semibold text-warning-text">Check the dose.</span>{" "}
                <span className="text-foreground/80">The audio at 01:42 was unclear — confirm 500 mg before approving.</span>
              </span>
            </div>

            <div data-from="4" style={d(450)} className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--mk-line)] pt-4">
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <BadgeCheck className="size-4 text-primary-text" />
                Only Dr. Sana can approve this
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-teal px-3.5 py-1.5 text-xs font-semibold text-brand-navy shadow-[0_8px_20px_-8px_var(--brand-teal)]">
                Review &amp; approve
              </span>
            </div>
          </Panel>
        </div>

        {/* Loop hint: the recording is kept, so a run can always be redone. */}
        <div className="flex items-center justify-center gap-2 border-t border-[var(--mk-line)] px-5 py-3 text-xs text-muted-foreground">
          <RotateCw className="size-3.5" />
          The recording is kept with the visit, so any note can be checked against what was said.
        </div>
      </div>
    </PhaseLoop>
  );
}
