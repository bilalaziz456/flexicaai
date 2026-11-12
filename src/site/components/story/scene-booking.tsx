"use client";

import { useRef } from "react";
import { BOOKING_CHAT, PhoneChat } from "../mockups/chat";
import { ScheduleCard } from "../mockups/clinic";
import { Container, Eyebrow, SampleTag, cx } from "../ui";
import { collapsed, expanded, useScrollScene, type SceneContext } from "./motion";

const STEPS = [
  "The patient messages the clinic",
  "The assistant asks which doctor",
  "The patient picks a day",
  "The doctor's hours are offered",
  "The patient picks a time",
  "The request is logged with a token",
  "The desk confirms — it's on the schedule",
];

/**
 * SCENE 1 — It starts with a conversation.
 *
 * One timeline drives the phone, the schedule card and the step list. On desktop the
 * section is tall and its stage sticks, so the timeline is scrubbed by scroll; on
 * phones the same timeline simply plays once when the phone comes into view.
 */
export function SceneBooking() {
  const root = useRef<HTMLElement>(null);

  const build = ({ gsap, q }: SceneContext, mode: "desktop" | "mobile") => {
    const msgs = q("[data-msg]");
    const typing = q("[data-typing]");
    const row = q("[data-new-row]")[0];
    const statusA = q("[data-status='a']")[0];
    const statusB = q("[data-status='b']")[0];
    const steps = q("[data-step]");

    gsap.set(msgs, collapsed);
    gsap.set(typing, { display: "block", ...collapsed });
    gsap.set(row, { height: 0, paddingTop: 0, paddingBottom: 0, autoAlpha: 0 });
    gsap.set(statusA, { opacity: 1 });
    gsap.set(statusB, { opacity: 0 });
    gsap.set(steps, { opacity: 0.35 });

    const tl = gsap.timeline({
      defaults: { duration: 0.5 },
      scrollTrigger:
        mode === "desktop"
          ? { trigger: root.current, start: "top top", end: "bottom bottom", scrub: 0.6 }
          : { trigger: q("[data-phone]")[0], start: "top 75%", once: true },
    });

    const lightStep = (i: number, at: string | number) => {
      tl.to(steps, { opacity: 0.35, duration: 0.2 }, at);
      tl.to(steps[i], { opacity: 1, duration: 0.2 }, at);
    };

    // Step indices per message: 0 msg0, 1 msg1, 2 msg2, 3 msg3, 4 msg4, 5 msg5, 6 desk+msg6.
    BOOKING_CHAT.forEach((m, i) => {
      if (i === 6) {
        // Before the final confirmation: the request lands on the schedule, then the desk confirms it.
        lightStep(6, ">");
        tl.to(row, { height: "auto", paddingTop: 10, paddingBottom: 10, autoAlpha: 1, ease: "power2.out", duration: 0.6 }, ">");
        tl.to(statusA, { opacity: 0, duration: 0.25 }, "+=0.35");
        tl.to(statusB, { opacity: 1, duration: 0.25 }, "<");
      } else {
        lightStep(i, ">");
      }
      const t = typing.find((el) => el.dataset.typing === String(i));
      if (t) {
        tl.to(t, { ...expanded, duration: 0.3 }, ">");
        tl.to(t, { height: 0, autoAlpha: 0, duration: 0.2 }, "+=0.45");
      }
      tl.to(msgs[i], { ...expanded }, t ? "<" : ">+=0.15");
    });
    tl.to({}, { duration: 0.6 }); // a short hold on the finished state
  };

  useScrollScene(root, {
    desktop: (c) => build(c, "desktop"),
    mobile: (c) => build(c, "mobile"),
  });

  return (
    <section ref={root} id="whatsapp-booking" aria-labelledby="scene-booking-title" className="relative overflow-x-clip bg-mist motion-safe:lg:h-[420vh]">
      <div className="motion-safe:lg:sticky motion-safe:lg:top-0 motion-safe:lg:flex motion-safe:lg:h-svh motion-safe:lg:items-center motion-safe:lg:pt-16">
        <div className="pointer-events-none absolute inset-0 grid-dots opacity-60 [mask-image:radial-gradient(ellipse_60%_60%_at_60%_50%,black,transparent)]" aria-hidden />
        <Container className="relative py-24 motion-safe:lg:py-0">
          <div className="grid items-center gap-14 lg:grid-cols-[0.9fr_auto_0.9fr] lg:gap-10 xl:gap-16">
            <div>
              <Eyebrow>04 · WhatsApp booking</Eyebrow>
              <h2 id="scene-booking-title" className="text-h2 mt-5 text-ink">
                It Starts With a Conversation.
              </h2>
              <p className="text-lead mt-5 max-w-md text-ink-soft">
                Patients can connect with your clinic through WhatsApp and book appointments without unnecessary calls or
                complicated processes.
              </p>
              <ol className="mt-9 hidden space-y-2.5 lg:block" aria-label="How a WhatsApp booking works">
                {STEPS.map((s, i) => (
                  <li key={s} data-step className="flex items-center gap-3 text-[0.95rem] text-ink transition-opacity">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white font-mono text-[11px] text-teal-ink ring-1 ring-mist-300">
                      {i + 1}
                    </span>
                    {s}
                  </li>
                ))}
              </ol>
            </div>

            <div data-phone className="relative lg:[@media(max-height:800px)]:scale-[0.84]">
              <div className="absolute -inset-10 -z-10 rounded-full bg-[radial-gradient(circle,rgb(15_180_187/0.18),transparent_65%)]" aria-hidden />
              <PhoneChat />
            </div>

            <div className="flex flex-col items-center gap-4 lg:items-start">
              <p className="eyebrow text-ink-mute">Meanwhile, at the clinic</p>
              <ScheduleCard />
              <p className={cx("max-w-[400px] text-[0.9rem] leading-relaxed text-ink-mute")}>
                Every WhatsApp booking is checked against the doctor&apos;s working hours, daily limit and leave before it
                reaches the schedule.
              </p>
              <SampleTag>Illustration · sample conversation</SampleTag>
            </div>
          </div>
        </Container>
      </div>
    </section>
  );
}
