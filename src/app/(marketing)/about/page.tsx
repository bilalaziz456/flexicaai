import {
  Activity,
  ArchiveRestore,
  BadgeCheck,
  CalendarDays,
  ChartColumnIncreasing,
  KeyRound,
  MessageCircle,
  MessagesSquare,
  Mic,
  Receipt,
  Rocket,
  Settings2,
  Stethoscope,
  UserRound,
  Wallet,
} from "lucide-react";
import { AboutHero } from "@/site/components/pages3d/about-hero";
import { AboutStory } from "@/site/components/pages3d/about-story";
import { PageMotion } from "@/site/components/pages3d/page-motion";
import { Band, CtaBand, CtaButtons, PageHero } from "@/site/components/site/page-blocks";
import { Ambient, FeatureCards, FlowChain, HubDiagram, IconTile, SpotCard, StepTimeline } from "@/site/components/site/rich";
import { Container, Eyebrow, JsonLd, SectionHeading } from "@/site/components/ui";
import { pageJsonLd, pageMetadata } from "@/site/lib/site";

const TITLE = "About — Clinic Software for Pakistan";
const DESCRIPTION =
  "FlexicaAI builds intelligent clinic software for clinics in Pakistan: one connected system for the whole team, and AI that drafts while clinicians decide.";

export const metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: "/about" });

const crumbs = [
  { name: "Home", path: "/" },
  { name: "About", path: "/about" },
];

const PRINCIPLES = [
  {
    icon: BadgeCheck,
    t: "AI drafts. Clinicians decide.",
    d: "Every AI output — a clinical note, a suggested reply — arrives as a draft. A clinical note becomes part of the record only when the doctor who dictated it approves it. Where the recording is unclear, the draft says so instead of guessing.",
  },
  {
    icon: ArchiveRestore,
    t: "Nothing is lost by accident.",
    d: "Health records get deleted by mistake. In FlexicaAI nothing is hard-deleted: a deleted item moves to a trash it can be restored from, and the activity log shows who did what, and when.",
  },
  {
    icon: KeyRound,
    t: "Each person sees what their work needs.",
    d: "Access is granted per person and per capability. A receptionist can run the diary and the bills without reading clinical notes; an owner can see the P&L without anyone sharing a login.",
  },
  {
    icon: MessageCircle,
    t: "WhatsApp first, because that is where patients are.",
    d: "Patients in Pakistan answer WhatsApp before they answer a call. Confirmations, reminders, reschedules and recalls happen there — with nothing to install.",
  },
];

// "A WhatsApp message becomes an appointment; the appointment becomes a visit; …"
const CHAIN = [
  { t: "WhatsApp message", icon: MessageCircle },
  { t: "Appointment", icon: CalendarDays },
  { t: "Visit", icon: Stethoscope },
  { t: "Structured note", icon: Mic },
  { t: "Bill", icon: Receipt },
  { t: "Profit & loss", icon: ChartColumnIncreasing },
];

const MODULES = [
  { t: "Patients", icon: UserRound },
  { t: "Appointments", icon: CalendarDays },
  { t: "WhatsApp", icon: MessageCircle },
  { t: "AI scribe", icon: Mic },
  { t: "Billing", icon: Receipt },
  { t: "Finance", icon: Wallet },
  { t: "Permissions", icon: KeyRound },
  { t: "Activity log", icon: Activity },
];

export default function AboutPage() {
  return (
    <>
      <JsonLd data={pageJsonLd({ path: "/about", name: "About FlexicaAI", description: DESCRIPTION, crumbs })} />
      <PageHero
        crumbs={crumbs}
        eyebrow="About FlexicaAI"
        title="Clinic software, built for how clinics here actually work."
        lead="FlexicaAI is an intelligent clinic platform for clinics in Pakistan. It brings appointments, patient records, WhatsApp communication, AI-assisted clinical notes, billing and financial reporting into one system — so the clinic runs on one source of truth instead of registers, spreadsheets and memory."
        aside={<AboutHero />}
      />

      <AboutStory />

      <Band tone="white" labelledBy="why-title" ambient>
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
          <div>
            <Eyebrow>Why we built it</Eyebrow>
            <h2 id="why-title" className="text-h2 mt-5 text-ink">
              The work around the consultation had outgrown paper.
            </h2>
          </div>
          <div className="text-lead space-y-6 text-ink-soft">
            <p>
              A busy clinic juggles a lot at once: patients booking by phone and WhatsApp, doctors with different
              hours and leave, treatment that runs over several visits, discounts that someone has to agree to, and
              money that comes in as cash, bank transfers and cheques. Most of that lives in a register, a spreadsheet or
              someone&apos;s head.
            </p>
            <p>
              FlexicaAI was built to connect that work. A WhatsApp message becomes an appointment; the appointment
              becomes a visit; the doctor&apos;s dictation becomes a structured note; the visit becomes a bill; the
              bills become a profit and loss an owner can read.
            </p>
            <p>
              It is designed for the way clinics in this region work — English and Urdu in the same consultation,
              printers the front desk already owns, and patients who expect to be reached on WhatsApp.
            </p>
          </div>
        </div>
        <FlowChain items={CHAIN} />
        <p className="mt-6 text-center text-[13px] text-ink-mute">One thread of work, from the first message to the owner&apos;s report.</p>
      </Band>

      <section className="band-dark grain relative overflow-hidden py-20 lg:py-28" aria-labelledby="principles-title">
        <Ambient dark />
        <Container className="relative">
          <SectionHeading id="principles-title" dark eyebrow="What we hold to" title="Four principles behind every screen." />
          <ol className="mt-16 grid gap-6 md:grid-cols-2">
            {PRINCIPLES.map((p, i) => (
              <li key={p.t}>
                <SpotCard dark className="relative overflow-hidden sm:p-10">
                  <span className="ghost-num absolute -top-3 right-3 text-[6rem]" aria-hidden>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <IconTile icon={p.icon} size="lg" className="relative" />
                  <h3 className="text-h3 relative mt-6 text-white">{p.t}</h3>
                  <p className="relative mt-4 leading-relaxed text-slate-300">{p.d}</p>
                </SpotCard>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <Band tone="mist" labelledBy="arch-title" ambient>
        <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-20">
          <div>
            <Eyebrow>How it is built</Eyebrow>
            <h2 id="arch-title" className="text-h2 mt-5 text-ink">
              One shared core, set up around your clinic.
            </h2>
            <div className="text-lead mt-6 space-y-5 text-ink-soft">
              <p>
                FlexicaAI is one connected system: patients, appointments, WhatsApp, the AI scribe, billing, finance,
                permissions and the activity log all work from the same records, so nothing has to be copied from one
                place to another.
              </p>
              <p>
                Each clinic sets it up around the way it already works — its own services and fees, its doctors and
                their hours, its team and what each person can access, its letterhead and its MRN series.
              </p>
            </div>
          </div>
          <div data-reveal>
            <HubDiagram core="FlexicaAI core" coreSub="One record per patient, shared by the whole clinic" modules={MODULES} />
          </div>
        </div>
      </Band>

      <Band tone="white" labelledBy="onboard-title" ambient>
        <SectionHeading
          id="onboard-title"
          eyebrow="Getting started"
          title="There is no sign-up form. We set your clinic up with you."
          lead="Every FlexicaAI account is provisioned by our team. We walk through how your clinic books, records and bills, then set the account up around it."
        />
        <StepTimeline
          steps={[
            { t: "A conversation", d: "Book a demo or message us on WhatsApp. We look at how your clinic runs today.", icon: MessagesSquare },
            { t: "Your setup", d: "Doctors and their hours, your services and prices, your team and what each person can access.", icon: Settings2 },
            { t: "Your first day", d: "Your team logs in to a clinic that already looks like theirs — with your letterhead and your MRN series.", icon: Rocket },
          ]}
        />
        <div className="mt-14 flex justify-center">
          <CtaButtons dark={false} />
        </div>
      </Band>

      <Band tone="mist" labelledBy="explore-title" ambient>
        <Eyebrow>Explore the platform</Eyebrow>
        <h2 id="explore-title" className="text-h2 mt-5 text-ink">
          Six areas, one connected clinic.
        </h2>
        <div className="mt-12">
          <FeatureCards numbered />
        </div>
      </Band>

      <CtaBand title="Let's build a smarter clinic together." />
      <PageMotion />
    </>
  );
}
