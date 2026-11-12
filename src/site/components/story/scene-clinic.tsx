"use client";

import { Check } from "lucide-react";
import dynamic from "next/dynamic";
import { useRef, useState, useSyncExternalStore } from "react";
import { ArrivalCard, PatientRecord } from "../mockups/clinic";
import { MockWindow, Pill, SAMPLE } from "../mockups/frame";
import { Container, Eyebrow, SampleTag, cx } from "../ui";
import { ClinicBus } from "./clinic-bus";
import { useScrollScene } from "./motion";
import { gpuTier, useNearViewport, useWide } from "./webgl";

const ClinicCanvas = dynamic(() => import("./clinic-scene"), { ssr: false });

const noop = () => () => {};

function Points({ items }: { items: string[] }) {
  return (
    <ul className="mt-7 space-y-2.5">
      {items.map((t) => (
        <li key={t} className="flex items-start gap-3 text-[0.95rem] text-ink-soft">
          <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-teal-soft text-teal-ink">
            <Check className="size-3" aria-hidden />
          </span>
          {t}
        </li>
      ))}
    </ul>
  );
}

/** The approved note, for when the 3D clinic (which shows it on a floating screen) is off. */
function ScribeSummaryCard() {
  const rows: [string, string][] = [
    ["Complaint", "Sore throat, fever · 3 days"],
    ["Diagnosis", "Acute tonsillitis"],
    ["Medicines", "Azithromycin 500 mg × 3 days"],
    ["Next visit", "Review in 1 week"],
  ];
  return (
    <MockWindow title={`AI clinical note · ${SAMPLE.patient}`} className="w-full max-w-[400px]" right={<Pill tone="approved">Approved</Pill>}>
      <dl className="space-y-2 text-[12.5px]">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[6.5rem_1fr] gap-3">
            <dt className="text-ink-mute">{k}</dt>
            <dd className="font-medium text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[11px] text-ink-mute">Approved by {SAMPLE.doctor} · drafted from her dictation</p>
    </MockWindow>
  );
}

/**
 * SCENES 2 + 3 — arrival, consultation, and the note done before the next patient.
 *
 * One pinned stage, one 3D clinic. The camera follows the patient in through the doors
 * to the front desk (Arrived), into the consultation room (the doctor greets them and
 * opens the record), then out again — while the doctor dictates, the AI drafts the note
 * on a floating screen, and the doctor approves it. Three text panes cross-fade over it.
 *
 * Without WebGL (phones, reduced motion, weak devices) the panes and product cards
 * stand on their own.
 */
export function SceneClinic() {
  const root = useRef<HTMLElement>(null);
  const [shared] = useState(() => new ClinicBus());
  const [ready, setReady] = useState(false);
  const tier = useSyncExternalStore(noop, gpuTier, () => "none" as const);
  const near = useNearViewport(root, "800px");
  const wide = useWide();
  const with3d = tier !== "none" && near;

  useScrollScene(root, {
    desktop: ({ gsap, q }) => {
      const [paneA, paneB, paneC] = q("[data-pane]");
      const arriveA = q("[data-arrive='a']")[0];
      const arriveB = q("[data-arrive='b']")[0];
      const recParts = q("[data-rec]");
      const cardA = q("[data-card='a']")[0];
      const cardB = q("[data-card='b']")[0];
      const cardC = q("[data-card='c']")[0];

      gsap.set([paneB, paneC], { autoAlpha: 0, y: 30 });
      gsap.set(cardC, { autoAlpha: 0, y: 30 });
      gsap.set(cardA, { autoAlpha: 0, y: 30 });
      gsap.set(cardB, { autoAlpha: 0, y: 30 });
      gsap.set(arriveA, { opacity: 1 });
      gsap.set(arriveB, { opacity: 0 });
      gsap.set(recParts, { autoAlpha: 0, y: 12 });

      const proxy = { p: 0 };
      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: { trigger: root.current, start: "top top", end: "bottom bottom", scrub: 0.8 },
      });
      // Total length 1 so positions read as progress.
      tl.to(
        proxy,
        {
          p: 1,
          duration: 1,
          onUpdate: () => shared.set(proxy.p),
        },
        0,
      );
      // Keep these in step with the keyframes in clinic-scene.tsx.
      tl.to(cardA, { autoAlpha: 1, y: 0, duration: 0.05, ease: "power2.out" }, 0.1);
      tl.to(arriveA, { opacity: 0, duration: 0.02 }, 0.22);
      tl.to(arriveB, { opacity: 1, duration: 0.02 }, 0.22);
      tl.to([paneA, cardA], { autoAlpha: 0, y: -30, duration: 0.04 }, 0.3);
      tl.to(paneB, { autoAlpha: 1, y: 0, duration: 0.05, ease: "power2.out" }, 0.35);
      tl.to(cardB, { autoAlpha: 1, y: 0, duration: 0.05, ease: "power2.out" }, 0.47);
      tl.to(recParts, { autoAlpha: 1, y: 0, duration: 0.03, stagger: 0.025, ease: "power2.out" }, 0.49);
      tl.to([paneB, cardB], { autoAlpha: 0, y: -30, duration: 0.04 }, 0.6);
      tl.to(paneC, { autoAlpha: 1, y: 0, duration: 0.05, ease: "power2.out" }, 0.64);
      tl.to(cardC, { autoAlpha: 1, y: 0, duration: 0.04, ease: "power2.out" }, 0.94);
    },
    mobile: ({ gsap, q }) => {
      // The clinic plays through as the three panes scroll past under it.
      const list = q("[data-panes]")[0];
      if (list) {
        const proxy = { p: 0 };
        gsap.to(proxy, {
          p: 1,
          ease: "none",
          onUpdate: () => shared.set(proxy.p),
          scrollTrigger: { trigger: list, start: "top 70%", end: "bottom 60%", scrub: 0.8 },
        });
      }
      q("[data-pane], [data-card]").forEach((el) => {
        gsap.from(el, { autoAlpha: 0, y: 28, duration: 0.8, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 85%", once: true } });
      });
    },
  });

  return (
    <section
      ref={root}
      id="journey"
      aria-label="At the clinic: arrival, consultation and the note"
      className="relative overflow-x-clip bg-[#eef4f9] motion-safe:lg:h-[640vh]"
    >
      <div className="relative motion-safe:lg:sticky motion-safe:lg:top-0 motion-safe:lg:h-svh motion-safe:lg:overflow-hidden">
        {/* Stage: the 3D clinic, or a quiet grid where 3D is off. */}
        <div className="absolute inset-0 hidden motion-safe:lg:block" aria-hidden>
          <div className="absolute inset-0 grid-dots opacity-70" />
          {with3d && wide && (
            <div className={cx("absolute inset-0 transition-opacity duration-1000", ready ? "opacity-100" : "opacity-0")}>
              <ClinicCanvas shared={shared} onReady={() => setReady(true)} />
            </div>
          )}
          {/* Edge light so the text and cards stay readable over the model. */}
          <div className="absolute inset-y-0 left-0 w-[42%] bg-gradient-to-r from-[#eef4f9] via-[#eef4f9]/85 to-transparent" />
          <div className="absolute inset-y-0 right-0 w-[30%] bg-gradient-to-l from-[#eef4f9]/90 via-[#eef4f9]/50 to-transparent" />
        </div>

        <Container className="relative py-24 motion-safe:lg:h-full motion-safe:lg:py-0 motion-safe:lg:pt-16">
          <div data-panes className="relative grid gap-20 motion-safe:lg:block motion-safe:lg:h-full">
            {/* Phones and tablets: the 3D clinic pins under the header while the panes scroll. */}
            {tier !== "none" && !wide && (
              <div className="sticky top-16 z-10 -mx-4 -mb-10 h-[min(80vw,420px)] bg-[#eef4f9] sm:-mx-6 lg:hidden" aria-hidden>
                <div className="absolute inset-0 grid-dots opacity-70" />
                {with3d && (
                  <div className={cx("absolute inset-0 transition-opacity duration-1000", ready ? "opacity-100" : "opacity-0")}>
                    <ClinicCanvas shared={shared} onReady={() => setReady(true)} />
                  </div>
                )}
                <div className="absolute inset-x-0 -bottom-6 h-6 bg-gradient-to-b from-[#eef4f9] to-transparent" />
              </div>
            )}
            {/* Pane A — arrival */}
            <div className="grid gap-10 motion-safe:lg:pointer-events-none motion-safe:lg:absolute motion-safe:lg:inset-0 lg:grid-cols-[minmax(0,430px)_1fr] lg:items-center">
              <div data-pane className="lg:pointer-events-auto">
                <Eyebrow>01 · Arrival</Eyebrow>
                <h2 className="text-h2 mt-5 text-ink">Every Visit, Perfectly Organised.</h2>
                <p className="text-lead mt-5 text-ink-soft">
                  From appointment scheduling to patient records and clinic reception, everything is organised in one place.
                </p>
                <Points
                  items={[
                    "The appointment confirmed on WhatsApp is already on the desk's queue",
                    "One tap marks the patient Arrived — the doctor sees it at once",
                    "Their record opens from the appointment, no searching",
                  ]}
                />
              </div>
              <div data-card="a" className="motion-safe:lg:invisible motion-safe:lg:opacity-0 flex flex-col items-start gap-3 lg:items-end lg:self-end lg:pb-[12vh] lg:pointer-events-auto">
                <ArrivalCard />
                <SampleTag>Illustration · sample patient</SampleTag>
              </div>
            </div>

            {/* Pane B — consultation */}
            <div className="grid gap-10 motion-safe:lg:pointer-events-none motion-safe:lg:absolute motion-safe:lg:inset-0 lg:grid-cols-[minmax(0,430px)_1fr] lg:items-center">
              <div data-pane className="lg:pointer-events-auto motion-safe:lg:invisible motion-safe:lg:opacity-0">
                <Eyebrow>02 · Consultation</Eyebrow>
                <h2 className="text-h2 mt-5 text-ink">More Focus on Patients. Less Time on Administration.</h2>
                <p className="text-lead mt-5 text-ink-soft">
                  Doctors can access patient history, appointments and relevant clinical information through a connected clinic
                  workspace.
                </p>
                <Points
                  items={[
                    "Allergies and medical history shown before anything else",
                    "Previous visits, X-rays and the treatment plan in one view",
                    "Notes, prescriptions and estimates live on the same record",
                  ]}
                />
              </div>
              <div data-card="b" className="motion-safe:lg:invisible motion-safe:lg:opacity-0 flex flex-col items-start gap-3 lg:items-end lg:self-end lg:pb-[8vh] lg:pointer-events-auto lg:origin-bottom-right lg:scale-[0.82] lg:[@media(max-height:820px)]:scale-[0.7]">
                <PatientRecord compact />
              </div>
            </div>

            {/* Pane C — the patient leaves; the note is dictated, drafted and approved */}
            <div className="grid gap-10 motion-safe:lg:pointer-events-none motion-safe:lg:absolute motion-safe:lg:inset-0 lg:grid-cols-[minmax(0,430px)_1fr] lg:items-center">
              <div data-pane className="lg:pointer-events-auto motion-safe:lg:invisible motion-safe:lg:opacity-0">
                <Eyebrow>03 · Before the Next Patient</Eyebrow>
                <h2 className="text-h2 mt-5 text-ink">The Patient Leaves. The Note Is Already Written.</h2>
                <p className="text-lead mt-5 text-ink-soft">
                  While the consultation is fresh, the doctor dictates it. FlexicaAI drafts the clinical note, and the doctor
                  reviews and approves it before calling the next patient.
                </p>
                <Points
                  items={[
                    "Dictate in English, Urdu or both — however you speak",
                    "Unclear words are flagged for the doctor, never guessed",
                    "Nothing reaches the record until the doctor approves it",
                  ]}
                />
              </div>
              <div data-card="c" className="motion-safe:lg:invisible motion-safe:lg:opacity-0 lg:self-end lg:pb-[10vh]">
                <div
                  className={cx(
                    "flex flex-col items-start gap-3 lg:items-end lg:pointer-events-auto",
                    // The 3D clinic shows this note on its floating screen.
                    with3d && ready && "motion-safe:lg:hidden",
                  )}
                >
                  <ScribeSummaryCard />
                  <SampleTag>Illustration · sample note</SampleTag>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </div>
    </section>
  );
}
