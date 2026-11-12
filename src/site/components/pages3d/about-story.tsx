"use client";

import { ArrowRight } from "lucide-react";
import dynamic from "next/dynamic";
import { Fragment } from "react";
import { StoryStage, type StoryStep } from "./story-stage";

const AboutScene = dynamic(() => import("./about-scene"), { ssr: false });

const CHAIN = ["WhatsApp message", "Appointment", "Visit", "Clinical note", "Bill", "Profit & loss"];

const STEPS: StoryStep[] = [
  {
    title: "Registers, spreadsheets and memory",
    text: "Bookings by phone and WhatsApp, doctors with different hours and leave, treatment over several visits, money in cash, transfers and cheques — in most clinics it lives in a register, a spreadsheet or someone's head.",
  },
  {
    title: "Pulled into one system",
    text: "FlexicaAI brings appointments, patient records, WhatsApp, AI-assisted clinical notes, billing and financial reporting together — built for English and Urdu, the printers the desk already owns, and patients on WhatsApp.",
  },
  {
    title: "One record per patient",
    text: "Patients, appointments, notes and bills work from the same records, so nothing has to be copied from one place to another.",
  },
  {
    title: "Every step connected",
    text: "A WhatsApp message becomes an appointment; the appointment becomes a visit; the dictation becomes a structured note; the visit becomes a bill; the bills become a profit and loss an owner can read.",
  },
];

/** Without 3D: the chain as a row of pills. */
function ChainFallback() {
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="The connected chain">
      {CHAIN.map((c, i) => (
        <Fragment key={c}>
          <li className="rounded-full border border-teal/50 bg-white/[0.06] px-4 py-2 text-[0.9rem] font-medium text-white">{c}</li>
          {i < CHAIN.length - 1 && (
            <li aria-hidden className="text-teal-glow">
              <ArrowRight className="size-4" />
            </li>
          )}
        </Fragment>
      ))}
    </ol>
  );
}

/** About: the paper a clinic runs on, collapsing into one source of truth. */
export function AboutStory() {
  return (
    <StoryStage
      id="one-source"
      dark
      heightVh={480}
      eyebrow="One source of truth"
      title="From paper to one connected record."
      steps={STEPS}
      Scene={AboutScene}
      fallback={<ChainFallback />}
      tag="Illustration · sample record"
    />
  );
}
