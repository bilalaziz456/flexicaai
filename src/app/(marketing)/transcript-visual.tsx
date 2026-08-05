import { Mic, ShieldCheck } from "lucide-react";

/**
 * Live transcription: words landing one at a time as the consultation is spoken, with
 * one phrase marked as unclear rather than guessed at.
 *
 * That flag is the whole point of the picture. Any scribe can produce fluent text; the
 * claim worth making is that when the audio is ambiguous it says so instead of
 * inventing a plausible dosage. Showing the uncertainty is more persuasive than
 * showing a perfect paragraph.
 *
 * Words fading IN is honest here — transcription genuinely arrives a word at a time,
 * so the arrival is the depiction, not a loading artifact. Everywhere content already
 * exists on this site it is present from the first frame.
 *
 * Server-rendered, CSS keyframes only. All on one 14s loop, staggered by
 * `animation-delay` in the markup so nothing can drift.
 */

/** `flag: true` marks the phrase the audio left ambiguous. */
const SPOKEN: { text: string; flag?: boolean }[] = [
  { text: "Patient" },
  { text: "reports" },
  { text: "the" },
  { text: "swelling" },
  { text: "has" },
  { text: "settled" },
  { text: "since" },
  { text: "the" },
  { text: "last" },
  { text: "visit." },
  { text: "Continue" },
  { text: "the" },
  { text: "same" },
  { text: "course" },
  { text: "at" },
  { text: "five" },
  { text: "hundred", flag: true },
  { text: "milligrams", flag: true },
  { text: "twice" },
  { text: "daily." },
];

/** Seconds between words. 20 words at 0.42s fills the panel in under 9s. */
const WORD_STEP = 0.42;

export function TranscriptVisual({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" data-motion-scope className={`relative w-full select-none ${className ?? ""}`}>
      <div className="absolute inset-8 -z-10 bg-[radial-gradient(circle_at_50%_40%,var(--brand-teal)_0%,transparent_65%)] opacity-15 blur-2xl dark:opacity-25" />

      <div className="rounded-2xl bg-card/70 p-5 ring-1 ring-primary/20 backdrop-blur">
        <div className="flex items-center justify-between">
          <p className="inline-flex items-center gap-2 font-mono text-2xs tracking-widest text-muted-foreground uppercase">
            <Mic className="size-3.5 text-primary-text" />
            Transcribing
          </p>
          <span className="inline-flex items-center gap-1.5 text-3xs font-medium tracking-wide text-muted-foreground uppercase">
            <span className="size-1.5 rounded-full bg-whatsapp motion-safe:animate-pulse" />
            Live
          </span>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-foreground/85">
          {SPOKEN.map((word, i) => (
            <span
              key={i}
              style={{ animationDelay: `${(i * WORD_STEP).toFixed(2)}s` }}
              className="motion-safe:animate-word-in"
            >
              {word.flag ? (
                <span
                  style={{ animationDelay: `${(i * WORD_STEP).toFixed(2)}s` }}
                  className="rounded-sm px-0.5 motion-safe:animate-flag-pulse"
                >
                  {word.text}
                </span>
              ) : (
                word.text
              )}{" "}
            </span>
          ))}
        </p>

        {/* Framed as a safeguard, not a fault. This was an amber warning box with an
            alert triangle, which is the correct SEMANTIC colour for "needs attention"
            but the wrong first impression in a page hero: the eye lands on an alert
            and reads "unclear / flagged / guessed" as the product struggling. The
            behaviour shown is unchanged and it is the page's strongest trust signal —
            only the framing moved from warning to reassurance. The amber marker stays
            on the words themselves, because that is what the flag actually looks like
            in the product. */}
        <div className="mt-5 flex items-start gap-2.5 rounded-xl bg-primary/[0.07] p-3 ring-1 ring-primary/20">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary-text" />
          <p className="text-xs leading-relaxed text-foreground/75">
            <span className="font-medium">Unclear audio is flagged, never guessed.</span>{" "}
            You confirm the dosage before anything is saved.
          </p>
        </div>
      </div>
    </div>
  );
}
