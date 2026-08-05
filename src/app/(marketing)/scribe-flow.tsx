import { Check, Mic } from "lucide-react";

/**
 * The "how it works" artwork: consultations being spoken, typed up as structured
 * notes, and approved — four of them, cycling.
 *
 * WHY it types rather than fades: an earlier version drew the note as grey bars that
 * faded in, which is the skeleton-screen idiom and read as "content still loading".
 * Text appearing behind a caret reads as text being WRITTEN, which is what the AI is
 * actually doing. Same principle as before — never animate content arriving — but a
 * caret changes what the arrival means.
 *
 * The copy is deliberately generic: complaint / findings / plan is the shape of a
 * consultation in any specialty, and no specialty vocabulary appears (CLAUDE.md §1).
 * No patient or provider is named. This illustrates a format, not a real record.
 *
 * Timing lives in the markup, not the stylesheet: every keyframe runs the full 28s
 * loop and each element's slot is set by `animation-delay` alone, so the four notes
 * cannot drift apart and a fifth would only need the two constants below changed.
 *
 * Server-rendered, no script. Everything is behind `motion-safe:` or a
 * reduced-motion query; the resting state is the first note, approved.
 */

/** Seconds per note. The keyframes in globals.css run a 28s loop and treat one slot
 *  as 25% of it, so this must stay `28 / NOTES.length` — change one, change both. */
const SLOT = 7;

/** Waveform bar heights (%). Irregular on purpose — an even pattern reads as a
 *  graphic equaliser rather than a voice. */
const WAVE = [34, 58, 26, 82, 48, 100, 40, 70, 30, 88, 52, 24, 66, 38, 60, 28];

const NOTES: { label: string; value: string }[][] = [
  [
    { label: "Complaint", value: "Here for a follow-up. The discomfort is easing." },
    { label: "Findings", value: "Healing as expected. Nothing new to report." },
    { label: "Plan", value: "Continue as prescribed. Review in four weeks." },
    { label: "Follow-up", value: "Reminder set for 4 weeks from today." },
  ],
  [
    { label: "Complaint", value: "New patient. Discomfort for the past week." },
    { label: "Findings", value: "Localised, no swelling. Vitals normal." },
    { label: "Plan", value: "Short course prescribed, with rest advised." },
    { label: "Follow-up", value: "Reminder set for 10 days from today." },
  ],
  [
    { label: "Complaint", value: "Routine check. No complaints raised." },
    { label: "Findings", value: "Everything within normal limits." },
    { label: "Plan", value: "No treatment needed today." },
    { label: "Follow-up", value: "Reminder set for 6 months from today." },
  ],
  [
    { label: "Complaint", value: "Reports the course was completed in full." },
    { label: "Findings", value: "Recovered. The site looks healthy." },
    { label: "Plan", value: "Discharge from active care." },
    { label: "Follow-up", value: "Reminder set for 12 months from today." },
  ],
];

/**
 * Everything is shifted this far back so the loop begins already 0.6s in.
 *
 * Without it the first note is INVISIBLE on load: `note-slot` starts at opacity 0 and
 * ramps up over its first 2%, and an animation's backwards fill overrides the base
 * class, so the card sat blank for half a second on every page load — and stayed
 * blank entirely wherever animations are throttled. Starting past the ramp means the
 * first note is drawn complete from the very first frame.
 */
const START_OFFSET = 0.6;

/** When note `i` starts its slot. */
const noteDelay = (i: number) => `${(i * SLOT - START_OFFSET).toFixed(2)}s`;
/** When row `j` of note `i` starts typing — staggered so they land in sequence. */
const rowDelay = (i: number, j: number) =>
  `${(i * SLOT + 0.45 + j * 0.7 - START_OFFSET).toFixed(2)}s`;

export function ScribeFlow({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" data-motion-scope className={`relative w-full select-none ${className ?? ""}`}>
      <div className="absolute inset-8 -z-10 bg-[radial-gradient(circle_at_50%_40%,var(--brand-teal)_0%,transparent_65%)] opacity-15 blur-2xl dark:opacity-25" />

      {/* ---- the consultation, being spoken ---- */}
      <div className="flex items-center gap-4 rounded-2xl bg-card/70 p-5 ring-1 ring-primary/20 backdrop-blur">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary-text ring-1 ring-primary/25">
          <Mic className="size-5" />
        </span>
        {/* The bars must NOT be flex-1, or they stretch into horizontal pills instead
            of standing up as a waveform. */}
        <div className="flex h-10 flex-1 items-center justify-between">
          {WAVE.map((h, i) => (
            <span
              key={i}
              style={{ height: `${h}%`, animationDelay: `${(i % 7) * 0.12}s` }}
              className="w-[3px] shrink-0 rounded-full bg-primary/70 motion-safe:animate-wave-bar"
            />
          ))}
        </div>
      </div>

      <div className="mx-auto h-7 w-px bg-gradient-to-b from-primary/50 to-primary/10" />

      {/* ---- the notes, cycling ----
          Stacked in one grid cell so the container holds the tallest note's height
          and nothing below it shifts as they swap. */}
      <div className="grid">
        {NOTES.map((rows, i) => (
          <div
            key={i}
            style={{ animationDelay: noteDelay(i) }}
            className={[
              "col-start-1 row-start-1 rounded-2xl bg-card/70 p-5 ring-1 ring-primary/20 backdrop-blur",
              // Resting state without animation: only the first note, so the four do
              // not pile on top of each other when motion is off.
              i === 0 ? "opacity-100" : "opacity-0",
              "motion-safe:animate-note-slot",
            ].join(" ")}
          >
            <div className="flex items-center justify-between">
              <p className="font-mono text-2xs tracking-widest text-muted-foreground uppercase">
                Consultation note
              </p>

              {/* Two chips on one spot. CSS cannot rewrite text, and keeping both in
                  the markup means each is a real, readable label. */}
              <span className="relative inline-flex h-6 items-center">
                <span
                  style={{ animationDelay: noteDelay(i) }}
                  className="rounded-full bg-card px-2.5 py-1 text-3xs font-medium tracking-wide text-primary-text uppercase opacity-0 ring-1 ring-primary/25 motion-safe:animate-note-draft"
                >
                  Draft
                </span>
                <span
                  style={{ animationDelay: noteDelay(i) }}
                  className="absolute inset-y-0 right-0 inline-flex items-center rounded-full bg-whatsapp/15 px-2.5 text-3xs font-medium tracking-wide text-whatsapp-fg uppercase ring-1 ring-whatsapp/40 motion-safe:animate-note-approved"
                >
                  Approved
                </span>
              </span>
            </div>

            <dl className="mt-4 space-y-2.5">
              {rows.map(({ label, value }, j) => (
                <div key={label} className="flex gap-3 text-sm leading-snug">
                  <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 text-foreground/80">
                    <span
                      style={{
                        // Overshot on purpose: `1ch` is the width of a zero, and a
                        // proportional face averages a little under that. Finishing a
                        // touch early is invisible; finishing short would clip a word.
                        ["--ch" as string]: Math.ceil(value.length * 1.1),
                        animationDelay: rowDelay(i, j),
                      }}
                      className="type-row"
                    >
                      {value}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>

            <div
              style={{ animationDelay: noteDelay(i) }}
              className="mt-5 flex items-center gap-2.5 border-t border-foreground/10 pt-4 motion-safe:animate-note-approved"
            >
              <span className="inline-flex size-6 items-center justify-center rounded-full bg-whatsapp/15">
                <Check className="size-3.5 text-whatsapp-fg" strokeWidth={3} />
              </span>
              <p className="text-xs text-muted-foreground">
                Reviewed and approved by the provider
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
