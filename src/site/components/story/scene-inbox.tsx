"use client";

import { BellRing, Bot, CalendarCheck2, CalendarClock, MessageCircle, RefreshCw, UserRound } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";
import { InboxWindow } from "../mockups/inbox";
import { Container, Eyebrow, SampleTag } from "../ui";
import { type SceneContext, useScrollScene } from "./motion";

const FLOWS = [
  { I: CalendarCheck2, t: "Booking confirmations", d: "Sent the moment the desk confirms." },
  { I: CalendarClock, t: "Day-before reminders", d: "Sent automatically the evening before." },
  { I: RefreshCw, t: "Reschedule by reply", d: "Checked against the doctor's hours and leave." },
  { I: BellRing, t: "Recalls", d: "Follow-ups and check-ups fall due on their own." },
  { I: Bot, t: "AI replies to common questions", d: "Timings, location, how to book." },
  { I: UserRound, t: "A queue for your team", d: "Anything else waits for a person." },
];

/** SCENE 5 — every patient conversation, connected. Plays once as it comes into view. */
export function SceneInbox() {
  const root = useRef<HTMLElement>(null);

  const build = ({ gsap, q }: SceneContext) => {
    const threads = q("[data-thread]");
    const msgs = q("[data-imsg]");
    const flows = q("[data-flow]");
    const tl = gsap.timeline({
      scrollTrigger: { trigger: q("[data-inbox]")[0], start: "top 75%", once: true },
      defaults: { ease: "power3.out" },
    });
    tl.from(threads, { autoAlpha: 0, x: -16, duration: 0.5, stagger: 0.08 });
    tl.from(msgs, { autoAlpha: 0, y: 14, scale: 0.97, duration: 0.45, stagger: 0.55 }, 0.4);
    gsap.from(flows, {
      autoAlpha: 0,
      y: 20,
      duration: 0.6,
      stagger: 0.07,
      ease: "power3.out",
      scrollTrigger: { trigger: flows[0], start: "top 85%", once: true },
    });
  };

  useScrollScene(root, { desktop: build, mobile: build });

  return (
    <section ref={root} aria-labelledby="scene-inbox-title" className="relative overflow-hidden bg-white py-24 lg:py-32">
      <div className="pointer-events-none absolute -left-40 top-20 size-[520px] rounded-full bg-[radial-gradient(circle,rgb(31_168_85/0.08),transparent_65%)]" aria-hidden />
      <Container className="relative">
        <div className="grid gap-14 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:items-center lg:gap-16">
          <div>
            <Eyebrow>06 · Patient communication</Eyebrow>
            <h2 id="scene-inbox-title" className="text-h2 mt-5 text-ink">
              Keep Every Patient Conversation Connected.
            </h2>
            <p className="text-lead mt-5 text-ink-soft">
              Manage patient conversations, appointment confirmations, reminders and follow-ups through an integrated WhatsApp
              workflow.
            </p>
            <p className="mt-5 text-[0.98rem] leading-relaxed text-ink-mute">
              Patients don&apos;t install anything. When a patient replies to move an appointment, FlexicaAI checks the
              doctor&apos;s schedule and updates the calendar; questions it can&apos;t answer go to your team.{" "}
              <Link href="/features/whatsapp-integration" className="font-medium text-teal-ink underline underline-offset-4">
                How the WhatsApp integration works
              </Link>
            </p>
          </div>
          <div data-inbox className="relative">
            <div className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-gradient-to-br from-teal-soft/70 via-mist to-white" aria-hidden />
            <InboxWindow />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="flex items-center gap-1.5 text-[12px] text-ink-mute">
                <MessageCircle className="size-3.5 text-wa" aria-hidden /> Sent through the WhatsApp Business API
              </p>
              <SampleTag>Sample conversations</SampleTag>
            </div>
          </div>
        </div>

        <ul className="mt-20 grid gap-px overflow-hidden rounded-3xl bg-mist-200 ring-1 ring-mist-200 sm:grid-cols-2 lg:grid-cols-3">
          {FLOWS.map(({ I, t, d }) => (
            <li key={t} data-flow className="flex gap-4 bg-white p-6">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-soft text-teal-ink">
                <I className="size-[18px]" aria-hidden />
              </span>
              <div>
                <h3 className="font-semibold text-ink">{t}</h3>
                <p className="mt-1 text-[0.92rem] leading-relaxed text-ink-mute">{d}</p>
              </div>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
