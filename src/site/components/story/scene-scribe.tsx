"use client";

import { useEffect, useRef } from "react";
import { NoteCard, RecorderCard, TranscriptCard } from "../mockups/scribe";
import { Container, Eyebrow, SampleTag } from "../ui";
import { useScrollScene } from "./motion";

const STEPS = [
  { t: "Record", d: "The doctor dictates after — or during — the consultation." },
  { t: "Transcribe", d: "Speech becomes text; unclear audio is marked, not guessed." },
  { t: "Structure", d: "AI organises it into a clinical note: findings, diagnosis, treatment and plan." },
  { t: "Review", d: "The draft opens for the doctor, with flagged parts highlighted." },
  { t: "Approve", d: "Only the doctor's approval makes it part of the patient record." },
];

/** The AI step: a quiet orbit, not a light show. Pure SVG + CSS. */
function Processor() {
  return (
    <div className="relative mx-auto grid aspect-square w-full max-w-[360px] place-items-center" aria-hidden>
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgb(15_180_187/0.28),transparent_62%)]" />
      <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full">
        <g className="origin-center motion-safe:animate-[spin_18s_linear_infinite]">
          <circle cx="100" cy="100" r="88" fill="none" stroke="rgb(95 224 228 / 0.25)" strokeDasharray="2 6" />
          <circle cx="188" cy="100" r="3" fill="#5fe0e4" />
          <circle cx="12" cy="100" r="2" fill="#5fe0e4" opacity="0.6" />
        </g>
        <g className="origin-center motion-safe:animate-[spin_11s_linear_infinite_reverse]">
          <circle cx="100" cy="100" r="64" fill="none" stroke="rgb(15 180 187 / 0.45)" strokeDasharray="40 14" />
          <circle cx="100" cy="36" r="3.5" fill="#0fb4bb" />
        </g>
        <g className="origin-center motion-safe:animate-[spin_7s_linear_infinite]">
          <circle cx="100" cy="100" r="42" fill="none" stroke="rgb(255 255 255 / 0.15)" />
          <circle cx="142" cy="100" r="2.5" fill="#fff" />
        </g>
        <polygon points="100,74 122.5,87 122.5,113 100,126 77.5,113 77.5,87" fill="rgb(15 180 187 / 0.18)" stroke="#5fe0e4" strokeWidth="1.4" />
      </svg>
      <div className="relative text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-teal-glow">Structuring</p>
        <p className="mt-1 text-[12px] text-slate-400">clinical note</p>
      </div>
    </div>
  );
}

/**
 * SCENE 4 — the AI clinical scribe.
 *
 * Desktop: a pinned stage scrubbed by scroll — recording and live transcript, the AI
 * step, then the structured note moving from DRAFT, to the doctor's edit of a flagged
 * line, to APPROVED. Phones and reduced motion see the three parts stacked, the note
 * in its approved state.
 */
export function SceneScribe() {
  const root = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  // Shrink the note to fit the pinned stage on short screens, so the Approve row is
  // never cut off. Measured, not guessed: the card's height depends on column width.
  useEffect(() => {
    const box = stage.current;
    const note = box?.querySelector<HTMLElement>("[data-stage='note']");
    if (!box || !note) return;
    const fit = () => {
      const natural = note.offsetHeight; // layout height, unaffected by `scale`
      const room = box.clientHeight;
      const k = natural > 0 && room > 0 ? Math.min(1, (room - 8) / natural) : 1;
      box.style.setProperty("--note-fit", k.toFixed(3));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    ro.observe(note);
    return () => ro.disconnect();
  }, []);

  useScrollScene(root, {
    desktop: ({ gsap, q }) => {
      const input = q("[data-stage='input']")[0];
      const ai = q("[data-stage='ai']")[0];
      const note = q("[data-stage='note']")[0];
      const words = q("[data-w]");
      const rows = q("[data-note-row]");
      const flag = q("[data-flag]")[0];
      const [draft, editing, approved] = ["draft", "editing", "approved"].map((s) => q(`[data-state='${s}']`)[0]);
      const flagA = q("[data-flag-text='a']")[0];
      const flagB = q("[data-flag-text='b']")[0];
      const approve = q("[data-approve]")[0];
      const steps = q("[data-sstep]");

      gsap.set(words, { opacity: 0.12 });
      gsap.set([ai, note], { autoAlpha: 0 });
      gsap.set(ai, { scale: 0.85 });
      gsap.set(note, { y: 40 });
      gsap.set(rows, { autoAlpha: 0, x: -10 });
      gsap.set(draft, { opacity: 1 });
      gsap.set([editing, approved], { opacity: 0 });
      gsap.set(flagA, { opacity: 1 });
      gsap.set(flagB, { opacity: 0 });
      gsap.set(steps, { opacity: 0.35 });

      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: { trigger: root.current, start: "top top", end: "bottom bottom", scrub: 0.7 },
      });
      const step = (i: number, at: number) => {
        tl.to(steps, { opacity: 0.35, duration: 0.01 }, at);
        tl.to(steps[i], { opacity: 1, duration: 0.01 }, at);
      };

      step(0, 0);
      step(1, 0.08);
      tl.to(words, { opacity: 1, duration: 0.24, stagger: { each: 0.24 / words.length } }, 0.04);
      step(2, 0.32);
      tl.to(input, { autoAlpha: 0, x: -60, scale: 0.94, duration: 0.06 }, 0.32);
      tl.to(ai, { autoAlpha: 1, scale: 1, duration: 0.06, ease: "power2.out" }, 0.34);
      tl.to(ai, { autoAlpha: 0, scale: 1.1, duration: 0.05 }, 0.46);
      tl.to(note, { autoAlpha: 1, y: 0, duration: 0.06, ease: "power2.out" }, 0.48);
      tl.to(rows, { autoAlpha: 1, x: 0, duration: 0.03, stagger: 0.016, ease: "power2.out" }, 0.52);
      step(3, 0.68);
      tl.fromTo(flag, { backgroundColor: "rgb(251 191 36 / 0)" }, { backgroundColor: "rgb(251 191 36 / 0.14)", duration: 0.04 }, 0.7);
      tl.to(draft, { opacity: 0, duration: 0.02 }, 0.76);
      tl.to(editing, { opacity: 1, duration: 0.02 }, 0.76);
      tl.to(flagA, { opacity: 0, duration: 0.03 }, 0.8);
      tl.to(flagB, { opacity: 1, duration: 0.03 }, 0.81);
      tl.to(flag, { backgroundColor: "rgb(52 211 153 / 0.1)", duration: 0.03 }, 0.81);
      step(4, 0.88);
      tl.to(approve, { scale: 0.94, duration: 0.015 }, 0.88);
      tl.to(approve, { scale: 1, duration: 0.015 }, 0.895);
      tl.to(editing, { opacity: 0, duration: 0.02 }, 0.9);
      tl.to(approved, { opacity: 1, duration: 0.02 }, 0.9);
      tl.to({}, { duration: 0.08 }, 0.92);
    },
    mobile: ({ gsap, q }) => {
      q("[data-stage]").forEach((el) => {
        gsap.from(el, { autoAlpha: 0, y: 28, duration: 0.8, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 85%", once: true } });
      });
    },
  });

  return (
    <section
      ref={root}
      id="ai-scribe"
      aria-labelledby="scene-scribe-title"
      className="band-dark grain relative overflow-x-clip motion-safe:lg:h-[420vh]"
    >
      <div className="relative motion-safe:lg:sticky motion-safe:lg:top-0 motion-safe:lg:flex motion-safe:lg:h-svh motion-safe:lg:items-center motion-safe:lg:overflow-hidden motion-safe:lg:pt-16">
        <div className="pointer-events-none absolute -right-40 top-1/4 size-[640px] rounded-full bg-[radial-gradient(circle,rgb(15_180_187/0.16),transparent_65%)]" aria-hidden />
        <div className="pointer-events-none absolute inset-0 grid-dots-dark [mask-image:radial-gradient(ellipse_60%_70%_at_70%_50%,black,transparent)]" aria-hidden />
        <Container className="relative py-24 motion-safe:lg:py-0">
          <div className="grid gap-14 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center lg:gap-16">
            <div>
              <Eyebrow dark>05 · AI Clinical Scribe</Eyebrow>
              <h2 id="scene-scribe-title" className="text-h2 mt-5 text-white lg:[@media(max-height:820px)]:text-[clamp(2rem,3.4vw,2.75rem)]">
                Your Consultation. Transformed Into Structured Clinical Notes.
              </h2>
              <p className="text-lead mt-5 text-slate-300 lg:[@media(max-height:820px)]:mt-4">
                FlexicaAI combines voice transcription and AI to help doctors turn consultation dictation into structured clinical
                notes.
              </p>
              <ol className="mt-8 space-y-3.5 lg:[@media(max-height:860px)]:mt-6 lg:[@media(max-height:860px)]:grid lg:[@media(max-height:860px)]:grid-cols-2 lg:[@media(max-height:860px)]:gap-x-6 lg:[@media(max-height:860px)]:gap-y-2.5 lg:[@media(max-height:860px)]:space-y-0">
                {STEPS.map((s, i) => (
                  <li key={s.t} data-sstep className="flex gap-4">
                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border border-teal/40 font-mono text-[11px] text-teal-glow">
                      {i + 1}
                    </span>
                    <div>
                      <p className="font-semibold text-white">{s.t}</p>
                      <p className="text-[0.92rem] leading-relaxed text-slate-400 lg:[@media(max-height:860px)]:hidden">{s.d}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="mt-8 rounded-2xl border lg:[@media(max-height:760px)]:hidden border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 text-[0.9rem] leading-relaxed text-amber-100">
                AI-generated notes are always drafts. The doctor who dictated the note reviews, edits and approves it — the AI
                never finalises a medical record on its own.
              </p>
            </div>

            <div ref={stage} className="relative grid gap-6 motion-safe:lg:block motion-safe:lg:h-[min(640px,calc(100svh-6rem))]">
              <div data-stage="input" className="grid gap-4 motion-safe:lg:absolute motion-safe:lg:inset-x-0 motion-safe:lg:top-1/2 motion-safe:lg:-translate-y-1/2">
                <RecorderCard />
                <TranscriptCard />
              </div>
              <div data-stage="ai" className="motion-safe:lg:absolute motion-safe:lg:inset-0 motion-safe:lg:grid motion-safe:lg:place-items-center">
                <Processor />
              </div>
              <div data-stage="note" className="origin-center motion-safe:lg:absolute motion-safe:lg:inset-x-0 motion-safe:lg:top-1/2 motion-safe:lg:-translate-y-1/2 motion-safe:lg:[scale:var(--note-fit,1)]">
                <NoteCard />
                <div className="mt-3 flex justify-end">
                  <SampleTag dark>Illustration · sample dictation and note</SampleTag>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </div>
    </section>
  );
}
