import type { Metadata } from "next";
import {
  BadgeCheck,
  ClipboardCheck,
  FileText,
  Languages,
  Mic,
  ShieldAlert,
  Timer,
} from "lucide-react";
import { ClosingBand, FeatureCard, PageHero, SectionHeading, Statement } from "../sections";
import { TranscriptVisual } from "../transcript-visual";
import { ScribeFlow } from "../scribe-flow";
import { pageJsonLd } from "../structured-data";

/**
 * The AI scribe page. Specialty-agnostic like the rest of the site: it describes the
 * engine, never a specialty's note format.
 *
 * The whole page is organised around the one thing that matters clinically — the AI
 * drafts and a human decides — rather than around how clever the transcription is.
 * That order is a product guarantee (CLAUDE.md §8), so the page states it plainly and
 * the artwork demonstrates it rather than asserting it.
 */

const TITLE = "AI medical scribe: voice to structured note | FlexicaAI";
const DESCRIPTION =
  "An AI medical scribe that turns a spoken consultation into a structured note. Unclear audio is flagged, not guessed, and a provider approves before anything saves.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/ai-medical-scribe" },
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", siteName: "FlexicaAI" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const IN_THE_NOTE = [
  {
    Icon: FileText,
    title: "Structured, not a paragraph",
    body: "Complaint, history, findings, plan and prescription land in their own fields, so the note is searchable and reportable later instead of being a wall of text.",
  },
  {
    Icon: ShieldAlert,
    title: "Unclear audio is flagged",
    body: "Where the recording is ambiguous, the scribe marks it for you to confirm. It does not invent a plausible dosage to make the note read well.",
  },
  {
    Icon: BadgeCheck,
    title: "Drugs checked against your list",
    body: "Medication names are validated against the formulary your practice actually uses before they are ever shown to you.",
  },
  {
    Icon: Languages,
    title: "Built for how people speak here",
    body: "Consultations in this region rarely stay in one language. The scribe handles the mix rather than expecting textbook English.",
  },
  {
    Icon: Timer,
    title: "Written while you are still talking",
    body: "The note is drafted from the recording, not typed up afterwards. The admin hour at the end of the day is the thing being removed.",
  },
  {
    Icon: ClipboardCheck,
    title: "Every edit is kept",
    body: "The original draft is stored alongside your approved version, so the gap between them is measurable and the model can be improved against real corrections.",
  },
];

const SAFEGUARDS = [
  {
    Icon: Mic,
    title: "The recording is the source",
    body: "Audio is stored against the visit, so an approved note can always be checked back against what was actually said.",
  },
  {
    Icon: ClipboardCheck,
    title: "A draft is not a record",
    body: "Until a provider approves it, the note is a draft and is labelled one. Nothing is quietly promoted, and nothing is billed off an unapproved note.",
  },
  {
    Icon: BadgeCheck,
    title: "The provider signs off",
    body: "Approval is attributed to a named account with a timestamp, and the activity log keeps that record independently.",
  },
];

export default function AiMedicalScribePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            pageJsonLd({ path: "/ai-medical-scribe", name: "AI medical scribe", description: DESCRIPTION }),
          ),
        }}
      />

      <PageHero
        eyebrow="AI medical scribe"
        lines={["Speak the visit.", "The note", "writes itself."]}
        lede="Record the consultation on any device. It comes back as a structured note you can read in seconds, with anything the audio left unclear flagged rather than guessed at."
        art={<TranscriptVisual className="reveal-up" />}
      />

      <section className="border-y border-foreground/10 bg-muted/40 py-12 sm:py-16">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="What you get back"
            title="A note, not a transcript"
            lede="A wall of dictated text is not a clinical record. The scribe returns the structure your practice already works in."
          />
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {IN_THE_NOTE.map((c) => (
              <FeatureCard key={c.title} {...c} />
            ))}
          </div>
        </div>
      </section>

      <section className="py-12 sm:py-16">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
          <div className="lg:order-2">
            <Statement
              eyebrow="The order never changes"
              lines={["The AI drafts.", "A human", "decides."]}
              lede="This is the part we will not bend on. No clinical content is finalised without a provider approving it, and the draft is visibly a draft until they do."
              cta={{ href: "/#security", label: "How your data is handled" }}
            />
          </div>
          <ScribeFlow className="reveal-up lg:order-1" />
        </div>

        <div className="mx-auto mt-12 grid w-full max-w-6xl gap-5 px-4 sm:px-6 md:grid-cols-3">
          {SAFEGUARDS.map((c) => (
            <FeatureCard key={c.title} {...c} />
          ))}
        </div>
      </section>

      <ClosingBand
        title="See it on one of your own consultations"
        lede="Bring a recording, or talk through a typical visit with us. You will see the draft, the flags and the approval step exactly as your providers would."
      />
    </>
  );
}
