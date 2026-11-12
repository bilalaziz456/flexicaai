"use client";

import dynamic from "next/dynamic";
import { StoryStage, type StoryStep } from "./story-stage";

const PlatformScene = dynamic(() => import("./platform-scene"), { ssr: false });

const STEPS: StoryStep[] = [
  {
    title: "Six core areas",
    text: "Patients, appointments, WhatsApp, the AI scribe, billing and analytics. Each area works on its own — and each makes the others better.",
  },
  {
    title: "One shared core",
    text: "Appointments, patients, WhatsApp, the AI scribe, billing and finance are one system, working from the same records.",
    points: ["One record per patient, shared by the whole clinic", "Nothing copied from one place to another"],
  },
  {
    title: "Each step feeds the next",
    text: "A WhatsApp booking lands in the diary, the visit becomes a note, the note becomes a bill, the bill becomes the P&L.",
  },
  {
    title: "One workspace for the whole team",
    text: "The front desk, every doctor and the owner work in the same system.",
    points: [
      "Front desk — bookings, arrivals, the queue and the bill",
      "Doctors — records, notes, plans and prescriptions",
      "Owner — sales, expenses, shares and profit and loss",
    ],
  },
];

const MODULES = ["Patients", "Appointments", "WhatsApp", "AI scribe", "Billing", "Analytics"];

/** Without 3D: the same idea as a plain diagram — one core, six areas, three roles. */
function Fallback() {
  return (
    <div className="rounded-[1.75rem] border border-mist-300 bg-white p-6 sm:p-8" role="img" aria-label="Diagram: one FlexicaAI core connecting patients, appointments, WhatsApp, the AI scribe, billing and analytics, used by the front desk, doctors and the owner.">
      <ul className="grid grid-cols-3 gap-3 text-center text-[13px] font-semibold text-white">
        {["Front desk", "Doctors", "Owner"].map((r) => (
          <li key={r} className="rounded-xl bg-navy-800 px-2 py-2.5">
            {r}
          </li>
        ))}
      </ul>
      <div className="mx-auto my-3 h-5 w-px bg-mist-300" aria-hidden />
      <div className="rounded-xl bg-navy-800 px-4 py-5 text-center ring-2 ring-teal/60">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-teal-glow">FlexicaAI core</p>
        <p className="mt-1 text-[13px] text-slate-300">One record per patient, shared by the whole clinic</p>
      </div>
      <div className="mx-auto my-3 h-5 w-px bg-teal" aria-hidden />
      <ul className="grid grid-cols-2 gap-3 text-center text-[13px] sm:grid-cols-3">
        {MODULES.map((m) => (
          <li key={m} className="rounded-xl bg-teal-soft px-2 py-3 font-semibold text-ink">
            {m}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The platform page's scroll story: separate areas → one core → the chain → the team. */
export function PlatformStory() {
  return (
    <StoryStage
      id="connected-core"
      eyebrow="How it fits together"
      title="Six areas. One connected core."
      steps={STEPS}
      Scene={PlatformScene}
      fallback={<Fallback />}
      tag="Illustration"
      heightVh={520}
    />
  );
}
