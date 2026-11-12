"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ShowcaseVisual, type ShowcaseKey } from "../mockups/showcase";
import { Container, SampleTag, SectionHeading, cx } from "../ui";
import { useScrollScene } from "./motion";

const FEATURES: { k: ShowcaseKey; t: string; d: string; href?: string }[] = [
  {
    k: "patients",
    t: "Patient management",
    d: "One record per patient with a permanent MRN: contact details, visits, notes, attachments, bills and balance.",
    href: "/features/patient-management",
  },
  {
    k: "appointments",
    t: "Appointment scheduling",
    d: "Book in seconds, see who is confirmed, who has arrived and who is with the doctor — from the desk or WhatsApp.",
    href: "/features/appointment-management",
  },
  {
    k: "doctor-schedule",
    t: "Doctor scheduling",
    d: "Working hours per weekday, a daily appointment limit and leave that blocks new bookings automatically.",
  },
  {
    k: "medical-history",
    t: "Patient medical history",
    d: "Allergies, conditions and current medicines up front, with X-rays and documents attached to the record.",
  },
  {
    k: "treatment-plans",
    t: "Treatment plans",
    d: "Multi-visit plans with estimates and plan discounts, printed on your clinic's letterhead for the patient.",
  },
  {
    k: "prescriptions",
    t: "Prescriptions",
    d: "Typed or carried over from an approved scribe note, printed on A4 letterhead or on your pre-printed pad.",
  },
  {
    k: "billing",
    t: "Billing and payments",
    d: "Invoices with per-line discounts, deposits and receipts. Prints on thermal, A5 or A4 — whatever the desk has.",
    href: "/features/billing-and-payments",
  },
  {
    k: "sales",
    t: "Sales reports",
    d: "Realised revenue by procedure, doctor and day, with receivables and discounts on their own pages.",
    href: "/features/clinic-analytics",
  },
  {
    k: "staff",
    t: "Staff management",
    d: "Doctors, receptionists and managers each get their own login — so every action has a name against it.",
  },
  {
    k: "analytics",
    t: "Clinic analytics",
    d: "Appointment, procedure and daybook reports, no-shows and profit and loss, each downloadable as a PDF.",
    href: "/features/clinic-analytics",
  },
  {
    k: "recalls",
    t: "Recall management",
    d: "Check-ups and follow-ups fall due on their own and go out on WhatsApp, so returning patients aren't forgotten.",
  },
  {
    k: "permissions",
    t: "Role-based permissions",
    d: "Grant each person exactly what their job needs. An activity log records who did what; deleted items can be restored.",
  },
];

/**
 * SCENE 6 — everything else the clinic needs, introduced one at a time.
 * Desktop: the list scrolls while one visual stays pinned and changes with it.
 * Phones: each feature carries its own visual inline.
 */
export function SceneFeatures() {
  const root = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);

  useScrollScene(root, {
    wide: ({ ScrollTrigger, q }) => {
      q("[data-feat]").forEach((el, i) => {
        ScrollTrigger.create({
          trigger: el,
          start: "top 55%",
          end: "bottom 55%",
          onToggle: (self) => self.isActive && setActive(i),
        });
      });
    },
    mobile: ({ gsap, q }) => {
      q("[data-feat]").forEach((el) => {
        gsap.from(el, { autoAlpha: 0, y: 24, duration: 0.7, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 88%", once: true } });
      });
    },
  });

  return (
    <section ref={root} id="platform" aria-labelledby="scene-features-title" className="relative overflow-x-clip bg-white py-24 lg:py-32">
      <Container>
        <SectionHeading
          id="scene-features-title"
          eyebrow="The features"
          title="Everything Your Clinic Needs. One Connected Workspace."
          lead="Appointments, patient records, WhatsApp, the AI scribe, billing and reports — built in, not bolted on, for the front desk, the doctors and the owner."
        />

        <div className="mt-16 grid gap-10 lg:mt-24 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-20">
          <ol className="relative">
            <span className="absolute bottom-6 left-[15px] top-6 hidden w-px bg-mist-300 lg:block" aria-hidden />
            {FEATURES.map((f, i) => (
              <li key={f.k} data-feat className="relative lg:flex lg:min-h-[52vh] lg:items-center">
                <div className="lg:pl-14">
                  <span
                    className={cx(
                      "absolute left-0 top-1/2 hidden size-[31px] -translate-y-1/2 place-items-center rounded-full font-mono text-[11px] transition-all duration-500 lg:grid",
                      active === i ? "bg-navy-800 text-white ring-4 ring-teal/25" : "bg-white text-ink-mute ring-1 ring-mist-300",
                    )}
                    aria-hidden
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3
                    className={cx(
                      "text-h3 transition-colors duration-500",
                      active === i ? "lg:text-ink" : "lg:text-ink-mute",
                      "text-ink",
                    )}
                  >
                    {f.t}
                  </h3>
                  <p className="mt-3 max-w-md text-[1rem] leading-relaxed text-ink-soft">{f.d}</p>
                  {f.href && (
                    <Link href={f.href} className="mt-4 inline-flex text-[0.93rem] font-semibold text-teal-ink underline-offset-4 hover:underline">
                      Learn more about {f.t.toLowerCase()} →
                    </Link>
                  )}
                  {/* Phones: the visual sits with its feature. */}
                  <div className="mt-6 lg:hidden">
                    <ShowcaseVisual k={f.k} />
                  </div>
                </div>
                <div className="h-14 lg:hidden" aria-hidden />
              </li>
            ))}
          </ol>

          {/* Wide screens: one pinned stage that follows the list. */}
          <div className="hidden lg:block" aria-hidden>
            <div className="sticky top-[calc(50svh-260px)] h-[520px]">
              <div className="absolute -inset-8 rounded-[2.5rem] bg-gradient-to-br from-white via-mist to-teal-soft/50" />
              {FEATURES.map((f, i) => (
                <div
                  key={f.k}
                  className={cx(
                    "absolute inset-0 grid place-items-center transition-all duration-700 ease-[var(--ease-out-expo)]",
                    active === i ? "visible translate-y-0 scale-100 opacity-100" : "invisible translate-y-6 scale-[0.97] opacity-0",
                  )}
                >
                  <ShowcaseVisual k={f.k} />
                </div>
              ))}
              <div className="absolute bottom-0 right-0">
                <SampleTag>Sample data</SampleTag>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
