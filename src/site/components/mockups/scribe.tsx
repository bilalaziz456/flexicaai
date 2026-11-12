import { AlertTriangle, Check, Mic, PenLine, ShieldCheck } from "lucide-react";
import { cx } from "../ui";
import { SAMPLE } from "./frame";

/**
 * The AI clinical scribe, following the app's real flow: the doctor records, the audio
 * is transcribed, the AI structures it into a DRAFT note, anything it could not make
 * out is FLAGGED for the doctor, and only the doctor's approval makes it the record.
 */

export const DICTATION =
  "Ayesha Khan, thirty-four. Sore throat and fever for three days, painful swallowing. Allergic to penicillin. On examination, temperature thirty-eight point four, tonsils enlarged and red with white patches, tender neck glands. Rapid strep test positive. Acute tonsillitis. Throat swab taken. Azithromycin five hundred, once a day for three days, paracetamol for fever, and… [unclear]. Review in one week.";

export const NOTE_SECTIONS: { k: string; v: string; flag?: boolean }[] = [
  { k: "Chief complaint", v: "Sore throat and fever, 3 days; painful swallowing." },
  { k: "Medical history", v: "Penicillin allergy." },
  { k: "Examination", v: "Temp 38.4 °C; tonsils enlarged with white exudate; tender cervical nodes." },
  { k: "Investigations", v: "Rapid strep test — positive." },
  { k: "Diagnosis", v: "Acute tonsillitis." },
  { k: "Treatment done", v: "Throat swab taken; advice on fluids and rest." },
  { k: "Plan", v: "Antibiotic course (penicillin avoided — allergy); review response." },
  { k: "Medicines", v: "Azithromycin 500 mg — once daily × 3 days; paracetamol 500 mg as needed." },
  { k: "Needs your review", v: "A second medicine was not clear in the recording. Please confirm.", flag: true },
  { k: "Next visit", v: "Review in 1 week." },
];

/** Waveform bars. `live` animates them with CSS; the scroll story can also drive them. */
export function Waveform({ bars = 44, live = true, className }: { bars?: number; live?: boolean; className?: string }) {
  return (
    <div className={cx("flex h-14 items-center gap-[3px]", className)} aria-hidden>
      {Array.from({ length: bars }, (_, i) => {
        // Deterministic heights (no Math.random during render: it would differ server vs client).
        const h = 0.3 + 0.7 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.45));
        return (
          <span
            key={i}
            data-bar
            className={cx("block w-[3px] rounded-full bg-gradient-to-t from-teal to-teal-glow", live && "wave-bar")}
            style={{ height: `${Math.round(h * 100)}%`, animationDelay: `${(i % 11) * 0.08}s` }}
          />
        );
      })}
    </div>
  );
}

export function RecorderCard({ className }: { className?: string }) {
  return (
    <div className={cx("glass-dark rounded-2xl p-5", className)}>
      <div className="flex items-center gap-3">
        <span className="relative grid size-11 place-items-center rounded-full bg-rose-500/90 text-white">
          <span className="absolute inset-0 rounded-full bg-rose-500/60 motion-safe:animate-pulse-ring" aria-hidden />
          <Mic className="relative size-5" aria-hidden />
        </span>
        <div>
          <p className="text-[13px] font-semibold text-white">Recording consultation</p>
          <p className="font-mono text-[11px] text-slate-400">
            {SAMPLE.patient} · <span data-rec-time>01:48</span>
          </p>
        </div>
      </div>
      <Waveform className="mt-4" />
    </div>
  );
}

export function TranscriptCard({ className }: { className?: string }) {
  return (
    <div className={cx("glass-dark rounded-2xl p-5", className)}>
      <p className="eyebrow !text-[10px] text-slate-400">Transcript</p>
      <p data-transcript className="mt-3 text-[13px] leading-relaxed text-slate-300">
        {DICTATION.split(" ").map((w, i) => (
          <span key={i} data-w className={w.startsWith("[") || w.startsWith("…") ? "rounded bg-amber-400/15 text-amber-200" : undefined}>
            {w}{" "}
          </span>
        ))}
      </p>
    </div>
  );
}

/**
 * The structured note. `[data-note-row]` rows fill in; `[data-state]` holds three
 * badges (draft / editing / approved) of which the story shows one at a time.
 * Rendered approved, the end state, for search engines and reduced motion.
 */
export function NoteCard({ className }: { className?: string }) {
  return (
    <div className={cx("glass-dark rounded-2xl", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] px-5 py-3.5">
        <div>
          <p className="text-[13px] font-semibold text-white">Clinical note · {SAMPLE.patient}</p>
          <p className="text-[11px] text-slate-400">Structured by AI from the doctor&apos;s dictation</p>
        </div>
        <span className="relative inline-grid">
          <span data-state="draft" className="col-start-1 row-start-1 opacity-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/15 px-2.5 py-1 text-[11px] font-semibold text-amber-200 ring-1 ring-amber-300/30">
              <PenLine className="size-3" aria-hidden /> Draft · awaiting review
            </span>
          </span>
          <span data-state="editing" className="col-start-1 row-start-1 opacity-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-400/15 px-2.5 py-1 text-[11px] font-semibold text-sky-200 ring-1 ring-sky-300/30">
              <PenLine className="size-3" aria-hidden /> Doctor editing
            </span>
          </span>
          <span data-state="approved" className="col-start-1 row-start-1">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 ring-1 ring-emerald-300/30">
              <ShieldCheck className="size-3" aria-hidden /> Approved by {SAMPLE.doctor}
            </span>
          </span>
        </span>
      </div>
      <dl className="divide-y divide-white/[0.05] px-5 py-1">
        {NOTE_SECTIONS.map((s) => (
          <div
            key={s.k}
            data-note-row
            {...(s.flag ? { "data-flag": "" } : {})}
            className={cx("grid grid-cols-[7.5rem_1fr] gap-3 py-2 text-[12.5px]", s.flag && "-mx-2 rounded-lg px-2")}
          >
            <dt className={cx("font-medium", s.flag ? "text-amber-200" : "text-slate-400")}>
              {s.flag && <AlertTriangle className="mr-1 inline size-3 -translate-y-px" aria-hidden />}
              {s.k}
            </dt>
            <dd className={cx(s.flag ? "text-amber-100" : "text-slate-100")}>
              {s.flag ? (
                <span className="relative inline-grid">
                  <span data-flag-text="a" className="col-start-1 row-start-1 opacity-0">
                    {s.v}
                  </span>
                  <span data-flag-text="b" className="col-start-1 row-start-1 text-emerald-100">
                    <Check className="mr-1 inline size-3 -translate-y-px text-emerald-300" aria-hidden />
                    Confirmed by doctor: no second medicine.
                  </span>
                </span>
              ) : (
                s.v
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex items-center justify-between gap-3 border-t border-white/[0.07] px-5 py-3.5">
        <p className="text-[11px] text-slate-400">AI output is a draft until a clinician approves it.</p>
        <span
          data-approve
          className="inline-flex items-center gap-1.5 rounded-full bg-teal px-3.5 py-1.5 text-[12px] font-semibold text-navy-900"
          aria-hidden
        >
          <Check className="size-3.5" /> Approve note
        </span>
      </div>
    </div>
  );
}
