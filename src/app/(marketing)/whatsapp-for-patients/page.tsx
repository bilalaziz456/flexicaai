import type { Metadata } from "next";
import {
  CalendarCheck2,
  Database,
  Hand,
  Inbox,
  MessageSquareText,
  PenLine,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { ClosingBand, SectionHeading } from "../sections";
import { AiBadge, CapabilityHero, Pipeline, type PipelineStep } from "../ai-kit";
import { WhatsAppAssistantDemo } from "../whatsapp-assistant-demo";
import { AutomationFeed } from "../automation-feed";
import { TriageBoard } from "../triage-board";
import { WhatsAppIcon } from "../whatsapp-icon";
import { pageJsonLd } from "../structured-data";

/**
 * The patient-messaging page.
 *
 * The argument it has to win is not "we send reminders" — everyone sends reminders.
 * It is that a patient can reply however they write — Roman Urdu, half a sentence, a
 * question about a fee — and get a correct answer, without anything moving on a guess.
 *
 * Story: the conversation, with the AI's work shown beside it (hero) → how a reply is
 * made, with the model's steps badged and the rules' steps not (pipeline) → everything
 * that goes out on its own (feed) → the guardrails, as a sorting board (never a medical
 * answer) → the ask.
 *
 * Accuracy notes, because this page is easy to overclaim:
 *  - The assistant (`whatsapp_ai`) and the fee/price replies are per-practice switches,
 *    off by default. The page says so beside the pipeline.
 *  - The assistant never books, moves or cancels anything: it restates the request, the
 *    patient sends it back, and the booking rules act (core/integrations/whatsapp/assistant.ts).
 *  - Clinical questions are never answered by a machine; they go to the front desk.
 */

const TITLE = "WhatsApp appointment reminders and booking | FlexicaAI";
const DESCRIPTION =
  "Send appointment reminders and confirmations on WhatsApp, and let patients reply to book or reschedule. Availability is checked before the system answers.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/whatsapp-for-patients" },
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", siteName: "FlexicaAI" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const INTENTS = ["Book", "Reschedule", "Cancel", "A price", "A doctor’s fee", "Timings", "Location"];

const REPLY_STEPS: PipelineStep[] = [
  {
    Icon: MessageSquareText,
    title: "A message arrives",
    body: "In whatever form the patient writes it — English, Roman Urdu, or both in one sentence.",
  },
  {
    Icon: Sparkles,
    title: "Reads what they want",
    ai: true,
    body: "Works out the request and the date meant by “parson 4 baje” or “next Monday evening”.",
    extra: (
      <div className="flex flex-wrap gap-1.5">
        {INTENTS.map((intent) => (
          <span
            key={intent}
            className="rounded-full bg-whatsapp/10 px-2.5 py-1 text-3xs font-semibold text-whatsapp-fg shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--whatsapp)_28%,transparent)]"
          >
            {intent}
          </span>
        ))}
      </div>
    ),
  },
  {
    Icon: Database,
    title: "Uses your details",
    body: "Your own price list, each doctor’s fee and hours, your address — nothing from anywhere else.",
  },
  {
    Icon: PenLine,
    title: "Writes the reply",
    ai: true,
    body: "Answers the question, or writes the request back for the patient to confirm by sending it.",
  },
  {
    Icon: CalendarCheck2,
    title: "Acts on confirmation",
    body: "Hours, leave and daily limits are checked by the same rules your staff book under — then it moves.",
  },
];

const GUARDRAILS = [
  {
    Icon: Hand,
    title: "Nothing moves on a guess",
    body: "If the assistant misreads a message, the patient sees it in the restated request and simply does not send it. A misunderstanding costs one message.",
  },
  {
    Icon: WhatsAppIcon,
    title: "Your own number",
    body: "Messages come from your practice’s WhatsApp Business number with your name on them, not a shared number nobody recognises.",
  },
  {
    Icon: Inbox,
    title: "One inbox for the desk",
    body: "Every message in and out is logged against the patient, so whoever is on the desk sees the whole conversation.",
  },
  {
    Icon: Smartphone,
    title: "Nothing to install",
    body: "No app, no portal, no password. It arrives where patients already read their messages, which is why it gets read.",
  },
];

export default function WhatsAppForPatientsPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            pageJsonLd({
              path: "/whatsapp-for-patients",
              name: "WhatsApp for patients",
              description: DESCRIPTION,
            }),
          ),
        }}
      />

      <CapabilityHero
        accent="green"
        eyebrow="Patient messaging"
        lines={["Any reply.", "Any language.", "Understood."]}
        lede="Reminders go out on their own. When a patient writes back — in Roman Urdu, half a sentence, or a question about a fee — FlexicaAI understands it, and nothing moves until the diary says it can."
        secondary={{ href: "#how-replies-work", label: "How a reply is made" }}
        art={<WhatsAppAssistantDemo />}
      />

      <section id="how-replies-work" className="scroll-mt-24 border-y border-[var(--mk-line)] bg-muted/40 py-24 sm:py-32">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="How a reply is made"
            title="Understanding from the AI. Decisions from your rules."
            lede="The assistant reads and writes. It never books, moves or cancels anything on its own — the patient confirms, and your booking rules act."
          />
          <div className="mt-16">
            <Pipeline steps={REPLY_STEPS} accent="green" />
          </div>
          <p className="reveal-up mx-auto mt-14 flex max-w-2xl flex-wrap items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <AiBadge>Optional</AiBadge>
            The assistant is switched on per practice. Reminders, confirmations and replies in
            the standard format work without it.
          </p>
        </div>
      </section>

      <section className="py-24 sm:py-32">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="Runs on its own"
            title="The messages nobody has time to send"
            lede="Each of these is a job somebody is doing by hand today, or quietly not doing at all."
          />
          <div className="mt-14">
            <AutomationFeed />
          </div>
        </div>
      </section>

      <section className="border-y border-[var(--mk-line)] bg-muted/40 py-24 sm:py-32">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="Guardrails"
            title="It never answers a medical question"
            lede="Every message is read before anything is sent. Routine requests get an answer; anything about symptoms, diagnosis or medication goes to a person on your front desk."
          />
          <div className="mt-16">
            <TriageBoard />
          </div>

          {/* The rest of the guarantees, as a quiet ruled row rather than more cards. */}
          <ul className="mt-20 grid gap-y-10 border-t border-[var(--mk-line)] pt-12 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-[var(--mk-line)]">
            {GUARDRAILS.map(({ Icon, title, body }) => (
              <li key={title} className="reveal-up group lg:px-7 lg:first:pl-0 lg:last:pr-0 sm:pr-6">
                <span className="inline-flex size-10 items-center justify-center rounded-2xl bg-whatsapp/12 text-whatsapp-fg transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-105">
                  <Icon className="size-5" />
                </span>
                <h3 className="mt-5 font-semibold tracking-[-0.01em]">{title}</h3>
                <p className="mt-2 text-[0.92rem] leading-relaxed text-muted-foreground">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <ClosingBand
        title="Send yourself a reminder"
        lede="Message us and we will show you the whole loop on a real number: the confirmation, the reminder, the reply, and the diary updating behind it."
      />
    </>
  );
}
