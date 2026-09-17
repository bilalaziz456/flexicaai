import type { Metadata } from "next";
import {
  AlertTriangle,
  AudioLines,
  BadgeCheck,
  ClipboardCheck,
  FileText,
  Languages,
  Lock,
  Mic,
  RotateCw,
  ShieldAlert,
  Sparkles,
  Timer,
} from "lucide-react";
import { ClosingBand, SectionHeading, Statement } from "../sections";
import { AiBadge, CapabilityHero, CapabilityList, Pipeline, Showcase, type PipelineStep } from "../ai-kit";
import { ScribeStudio } from "../scribe-studio";
import { ScribeHeroArt } from "../scribe-hero-art";
import { NoteAnatomy } from "../note-anatomy";
import { pageJsonLd } from "../structured-data";

/**
 * The AI scribe page — the site's most "AI" page, and the one that has to be most
 * careful about it.
 *
 * Story: the glance (hero) → a whole note being written (studio) → how it works
 * (pipeline, with the AI's steps badged and the human's not) → understanding slowed
 * down (anatomy) → the guarantee that makes it safe (draft states) → what else comes
 * back → the ask.
 *
 * Specialty-agnostic like the rest of the site: it describes the engine, never a
 * specialty's note format. Every behaviour shown is the product's (CLAUDE.md §8,
 * `.claude/ai-scribe.md`); things it does not do — speaker separation, confidence
 * scores, auto-approval — are deliberately absent from the artwork too.
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

const STEPS: PipelineStep[] = [
  {
    Icon: Mic,
    title: "Record",
    body: "Hit record on a phone, tablet or laptop and see the patient the way you always do. No template, no form.",
  },
  {
    Icon: AudioLines,
    title: "Transcribe",
    ai: true,
    body: "Speech becomes text — including consultations that move between languages, the way they do here.",
  },
  {
    Icon: Sparkles,
    title: "Understand",
    ai: true,
    body: "The clinically relevant parts are lifted out of the conversation, and anything the audio left unclear is flagged.",
  },
  {
    Icon: FileText,
    title: "Draft",
    ai: true,
    body: "A structured note is written, medicines checked against your formulary. It arrives as a draft.",
  },
  {
    Icon: BadgeCheck,
    title: "Approve",
    body: "Only the provider who dictated it can approve it. Then the prescription, the bill and the follow-up follow.",
  },
];

const IN_THE_NOTE = [
  {
    Icon: FileText,
    title: "Structured, not a paragraph",
    body: "Complaint, history, findings, plan and prescription land in their own fields, so the note is searchable and reportable later.",
  },
  {
    Icon: ShieldAlert,
    title: "Unclear audio is flagged",
    body: "Where the recording is ambiguous, the scribe marks it for you to confirm. It does not invent a plausible dosage to make the note read well.",
  },
  {
    Icon: BadgeCheck,
    title: "Drugs checked against your list",
    body: "Medication names are validated against the formulary your practice uses, and against the patient’s recorded allergies.",
  },
  {
    Icon: Languages,
    title: "Built for how people speak here",
    body: "Consultations in this region rarely stay in one language. The scribe handles the mix rather than expecting textbook English.",
  },
  {
    Icon: Timer,
    title: "Written while you see the next patient",
    body: "The note is drafted in the background from the recording. The admin hour at the end of the day is the thing being removed.",
  },
  {
    Icon: ClipboardCheck,
    title: "Every edit is kept",
    body: "The original draft is stored beside your approved version, so the gap between them is measurable and the model can be improved against real corrections.",
  },
];

/** The lifecycle of a note, as the product actually runs it. */
function DraftStates() {
  const node = "relative z-10 inline-flex shrink-0 items-center justify-center";
  return (
    <div className="reveal-up mk-card rounded-[1.75rem] p-6 sm:p-8">
      <ol className="relative space-y-7">
        <span aria-hidden="true" className="absolute top-6 bottom-32 left-[21px] w-px bg-gradient-to-b from-brand-teal via-warning to-success" />
        <li className="flex gap-4">
          <span className={`${node} size-11 rounded-2xl bg-brand-teal/15 text-primary-text`}>
            <Sparkles className="size-5" />
          </span>
          <div>
            <p className="flex flex-wrap items-center gap-2 font-semibold">
              Transcribing <AiBadge>Working</AiBadge>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Runs in the background. The provider carries on with the next patient.
            </p>
          </div>
        </li>
        <li className="flex gap-4">
          <span className={`${node} size-11 rounded-2xl bg-warning/15 text-warning-text`}>
            <FileText className="size-5" />
          </span>
          <div>
            <p className="flex flex-wrap items-center gap-2 font-semibold">
              Draft
              <span className="inline-flex items-center gap-1 rounded-full bg-foreground/[0.06] px-2 py-0.5 text-3xs font-semibold text-muted-foreground">
                <Lock className="size-2.5" /> Author only
              </span>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Labelled a draft everywhere it appears. Nothing is billed or sent from it, and
              only the provider who dictated it can approve it.
            </p>
          </div>
        </li>
        <li className="flex gap-4">
          <span className={`${node} size-11 rounded-2xl bg-success/15 text-success-text`}>
            <BadgeCheck className="size-5" />
          </span>
          <div>
            <p className="font-semibold">Approved</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Becomes the record, attributed to a named account with a timestamp. The AI’s
              original draft is kept beside it.
            </p>
          </div>
        </li>
        <li className="flex gap-4 rounded-2xl bg-muted/60 p-4">
          <span className={`${node} size-9 rounded-xl bg-destructive/10 text-destructive-text`}>
            <AlertTriangle className="size-4" />
          </span>
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold">
              If a run fails <RotateCw className="size-3.5 text-muted-foreground" />
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              The recording is kept, so trying again is one click — never a second dictation.
            </p>
          </div>
        </li>
      </ol>
    </div>
  );
}

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

      <CapabilityHero
        eyebrow="AI medical scribe"
        lines={["Speak the visit.", "The note", "writes itself."]}
        lede="FlexicaAI listens to the consultation, understands what matters clinically, and hands you a structured note to approve — with anything the audio left unclear flagged, never guessed."
        secondary={{ href: "#watch-it-work", label: "Watch it work" }}
        art={<ScribeHeroArt />}
      />

      <Showcase
        id="watch-it-work"
        eyebrow="Watch it work"
        title="From a spoken consultation to a draft note"
        lede="Voice on the left, the AI working in the middle, the note writing itself on the right — in the order the product really runs."
      >
        <ScribeStudio />
      </Showcase>

      <section id="how-it-works" className="scroll-mt-24 py-24 sm:py-32">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="How it works"
            title="From a conversation to a clinical note"
            lede="Five steps. The AI does three of them, and they are marked. The last one is always a person."
          />
          <div className="mt-16">
            <Pipeline steps={STEPS} />
          </div>
        </div>
      </section>

      <section className="border-y border-[var(--mk-line)] bg-muted/40 py-24 sm:py-32">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="Understanding, slowed down"
            title="Every phrase lands where it belongs"
            lede="The scribe does not squash a consultation into a paragraph. It works out what each thing that was said is — and what should happen because of it."
          />
          <div className="mt-16">
            <NoteAnatomy />
          </div>
        </div>
      </section>

      <section className="px-4 py-24 sm:px-6 sm:py-32">
        <div className="mk-inverse relative isolate mx-auto w-full max-w-6xl overflow-hidden rounded-[2rem] px-5 py-16 ring-1 ring-white/10 sm:px-12 sm:py-20">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-40 -left-40 -z-10 h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(circle,var(--brand-teal)_0%,transparent_65%)] opacity-25 blur-3xl"
          />
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-teal/60 to-transparent" />
          <div className="grid items-center gap-14 lg:grid-cols-2">
            <Statement
              eyebrow="The order never changes"
              lines={["The AI drafts.", "A human", "decides."]}
              lede="This is the part we will not bend on. No clinical content is finalised without the provider who dictated it approving it, and the draft is visibly a draft until they do."
              cta={{ href: "/#security", label: "How your data is handled" }}
            />
            <DraftStates />
          </div>
        </div>
      </section>

      <section className="border-y border-[var(--mk-line)] bg-muted/40 py-24 sm:py-32">
        <div className="mx-auto grid w-full max-w-6xl gap-14 px-4 sm:px-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-20">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <SectionHeading
              align="left"
              eyebrow="What you get back"
              title="A note, not a transcript"
              lede="A wall of dictated text is not a clinical record. The scribe returns the structure your practice already works in."
            />
          </div>
          <div className="grid gap-x-10 gap-y-10 sm:grid-cols-2">
            <CapabilityList title="In the note" items={IN_THE_NOTE.slice(0, 3)} />
            <CapabilityList title="Around it" items={IN_THE_NOTE.slice(3)} />
          </div>
        </div>
      </section>

      <ClosingBand
        title="See it on one of your own consultations"
        lede="Bring a recording, or talk through a typical visit with us. You will see the draft, the flags and the approval step exactly as your providers would."
      />
    </>
  );
}
