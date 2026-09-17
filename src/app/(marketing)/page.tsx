import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  BadgeCheck,
  BookOpen,
  Calculator,
  Fingerprint,
  History,
  Layers,
  Mail,
  Mic,
  NotebookPen,
  Plus,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { HeroProduct } from "./hero-product";
import { HeroParallax } from "./hero-parallax";
import { ProductTour, type TourStep } from "./product-tour";
import { FeatureBento } from "./feature-bento";
import { ScribeFlow } from "./scribe-flow";
import { WhatsAppThread } from "./whatsapp-thread";
import { BillingVisual } from "./billing-visual";
import { RecallVisual } from "./recall-visual";
import { SecurityVisual } from "./security-visual";
import { Magnetic } from "./magnetic";
import { WhatsAppCta } from "./whatsapp-cta";
import { WhatsAppIcon } from "./whatsapp-icon";
import { SALES_EMAIL, SALES_EMAIL_URL, SALES_WHATSAPP_URL } from "./contact-details";
import {
  ClosingBand,
  FeatureCard,
  HeroBackdrop,
  SecondaryButton,
  SectionHeading,
  Statement,
} from "./sections";
import { ORGANIZATION, ORIGIN } from "./structured-data";

/**
 * The public landing page. A server component with no data fetching, so it builds to
 * static HTML (see the root layout note on why that is possible at all).
 *
 * Copy rule, deliberately enforced here: the platform's core is specialty-agnostic
 * (CLAUDE.md §1), so the marketing language is too. It says "practice", "provider"
 * and "health" — never a named specialty. The Specialties section is the only place
 * that acknowledges specialty modules exist, and even there it names none.
 *
 * No invented social proof: there are no customer counts, logos or testimonials on
 * this page, because we do not have real ones to show. Every claim below is
 * something the product actually does today. Figures inside the product mock-ups are
 * a sample day and read as such.
 *
 * Story order: what it is (hero) → the problem → the day, step by step (tour) →
 * everything else it does (bento) → the platform → security → questions → the ask.
 */

/**
 * Title and description carry the search terms; the page's own copy stays in brand
 * voice — "AI-powered health management system", matching the logo, the root layout
 * and the site footer.
 *
 * "Medical scribe" is kept because it is what people type. "Practice management
 * software" was dropped from both when the brand line changed: it survives only in
 * the structured data's `applicationSubCategory`, where it is a category term rather
 * than copy. That is a deliberate trade of one search phrase for brand consistency.
 *
 * Length matters here: a description over ~155 characters gets truncated in results,
 * so the sentence has to land the point before it is cut. This one is 154.
 */
const TITLE = "FlexicaAI: AI-powered health management system for clinics";
const DESCRIPTION =
  "AI-powered health management system with a medical scribe. Turn a spoken consultation into an approved note, automate WhatsApp reminders, track the money.";

/**
 * Structured data. Three things a search engine cannot infer from prose: that
 * FlexicaAI is an organisation, that this domain is its site, and that the product is
 * a piece of software with a category.
 *
 * Deliberately no `aggregateRating`, `review` or `offers`. Those are the fields that
 * produce star ratings and prices in results, and we have no real ratings and no
 * published price — inventing them would be fabricating social proof, and Google
 * penalises unverifiable review markup anyway.
 */
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    // The shared node, not a second copy. This page defined its own Organization
    // before structured-data.ts existed, which meant two definitions of the same
    // @id — and the homepage silently missing anything added to the shared one
    // (`sameAs`, most recently).
    { ...ORGANIZATION, description: DESCRIPTION },
    {
      "@type": "WebSite",
      "@id": `${ORIGIN}/#website`,
      url: ORIGIN,
      name: "FlexicaAI",
      publisher: { "@id": `${ORIGIN}/#organization` },
      inLanguage: "en",
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${ORIGIN}/#software`,
      name: "FlexicaAI",
      applicationCategory: "HealthApplication",
      // Left as the schema.org vocabulary term even though the page copy now says
      // "health management system". This field is a machine-readable CATEGORY, not
      // brand voice: "Practice management software" is the phrase search engines
      // recognise for this class of product, and inventing a category name here
      // classifies the product as nothing at all.
      applicationSubCategory: "Practice management software",
      operatingSystem: "Web browser",
      url: ORIGIN,
      description: DESCRIPTION,
      publisher: { "@id": `${ORIGIN}/#organization` },
      featureList: [
        "AI medical scribe",
        "WhatsApp appointment reminders and booking",
        "Patient recalls",
        "Scheduling and queue management",
        "Invoicing, receipts and payments",
        "Revenue and expense reporting",
        "Role-based access control",
        "Activity audit log",
      ],
    },
  ],
};

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    siteName: "FlexicaAI",
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function LandingPage() {
  return (
    <>
      {/* JSON-LD is a data block, not executable script, so the nonce-based CSP does
          not apply to it — which matters because this page is prerendered and has no
          per-request nonce to give it. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
      />
      <Hero />
      <Problem />
      <Tour />
      <Capabilities />
      <Specialties />
      <Security />
      <Faq />
      <ClosingBand
        title="See it on your own workflow"
        lede="Send us a message and we will walk you through it with your own practice in mind: how you book, how you chart, how you bill. No obligation."
        secondary={
          <SecondaryButton href={SALES_EMAIL_URL} icon={<Mail className="size-4" aria-hidden="true" />}>
            {SALES_EMAIL}
          </SecondaryButton>
        }
      />
    </>
  );
}

/* ---------------------------------------------------------------- hero ---- */

/** Plain capability facts under the hero — deliberately not fabricated customer
 *  metrics. When real proof exists (customer count, logos), it belongs here. */
const VALUES = [
  { Icon: Mic, text: "Notes drafted while you speak" },
  { Icon: BadgeCheck, text: "Nothing final until a provider approves" },
  { Icon: WhatsAppIcon, text: "Patients need no app, just WhatsApp" },
  { Icon: ShieldCheck, text: "Every practice's data kept separate" },
];

const rise = (ms: number) => ({ "--mk-delay": `${ms}ms` }) as CSSProperties;

function Hero() {
  return (
    <section data-motion-scope className="relative isolate overflow-hidden">
      <HeroBackdrop />

      <div className="mx-auto grid w-full max-w-6xl items-center gap-20 px-4 pt-12 pb-24 sm:px-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] lg:gap-16 lg:pt-20 lg:pb-32">
        <div>
          {/* The kicker lives INSIDE the h1 on purpose: it puts the term people search
              for into the page's most weighted element, at no visual cost. It is a
              block-level box so it gets its own line instead of being trapped in the
              h1's tall line box. */}
          <h1 className="mk-display">
            <span className="mk-rise mb-7 flex w-fit items-center gap-2 rounded-full bg-brand-teal/[0.09] py-1.5 pr-3.5 pl-2 text-xs leading-none font-semibold tracking-normal text-primary-text shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--brand-teal)_26%,transparent)]">
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-brand-teal text-brand-navy">
                <Sparkles className="size-3" aria-hidden="true" />
              </span>
              AI-powered health management system
            </span>
            <span className="mk-rise block" style={rise(90)}>
              Spend your day
            </span>{" "}
            <span className="mk-rise block" style={rise(180)}>
              on care,
            </span>{" "}
            <span className="mk-rise block" style={rise(270)}>
              <span className="mk-gradient-text">not paperwork</span>
            </span>
          </h1>

          <p
            className="mk-rise mt-7 max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground sm:text-xl"
            style={rise(300)}
          >
            FlexicaAI listens to the consultation and drafts the note, keeps patients
            coming back over WhatsApp, and shows you exactly where the money goes.
          </p>

          <div className="mk-rise mt-10 flex flex-wrap items-center gap-3" style={rise(420)}>
            <Magnetic>
              <WhatsAppCta ping>Book a demo on WhatsApp</WhatsAppCta>
            </Magnetic>
            <SecondaryButton href="#how">See how it works</SecondaryButton>
          </div>

          <p className="mk-rise mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground" style={rise(520)}>
            <a href={SALES_EMAIL_URL} className="inline-flex items-center gap-2 py-1 transition-colors hover:text-foreground">
              <Mail className="size-4" aria-hidden="true" />
              <span className="mk-link">Email us</span>
            </a>
            <span aria-hidden="true" className="h-4 w-px bg-[var(--mk-line-strong)]" />
            {/* inline-flex + py-1: vertical padding on a bare inline <a> does not add
                to layout height, and this has to clear the 24px minimum target. */}
            <span>
              Already a customer?{" "}
              <Link href="/login" className="mk-link inline-flex items-center py-1 font-semibold text-foreground">
                Sign in
              </Link>
            </span>
          </p>
        </div>

        {/* The pointer parallax only publishes two numbers; with no script the product
            composition is complete and simply sits still. Padded so the floating cards
            have room and never push past the viewport on a phone. */}
        <HeroParallax className="relative mx-auto mt-10 w-full max-w-xl px-3 sm:mt-0 sm:px-8 lg:px-0">
          <HeroProduct />
        </HeroParallax>
      </div>

      <div className="border-y border-[var(--mk-line)] bg-card/40 backdrop-blur">
        <ul className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-x-6 gap-y-5 px-4 py-7 sm:px-6 lg:grid-cols-4 lg:divide-x lg:divide-[var(--mk-line)] lg:gap-0">
          {VALUES.map(({ Icon, text }) => (
            <li key={text} className="flex items-center gap-3 lg:justify-center lg:px-4">
              <Icon className="size-5 shrink-0 text-primary-text" aria-hidden="true" />
              <span className="text-sm font-medium text-foreground/80">{text}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- problem ---- */

const TOOLS = [
  { Icon: NotebookPen, name: "A notebook", pain: "Notes written up at the end of the day, if at all." },
  { Icon: Smartphone, name: "A personal phone", pain: "Reminders sent by hand, when someone remembers." },
  { Icon: BookOpen, name: "A paper register", pain: "Payments, advances and balances kept by hand." },
  { Icon: Calculator, name: "A calculator", pain: "Each provider's share worked out at month end." },
];

function Problem() {
  return (
    <section className="py-24 sm:py-32">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          align="left"
          eyebrow="The problem"
          title="Most practices run on four tools that never talk to each other"
          lede="Each one works on its own. Together they leave gaps nobody owns — and the gaps are where time and revenue leak out."
        />

        <ul className="mt-14 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {TOOLS.map(({ Icon, name, pain }) => (
            <li key={name} className="reveal-up rounded-3xl border border-dashed border-[var(--mk-line-strong)] p-4 sm:p-6">
              <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <p className="mt-4 font-semibold sm:mt-5">{name}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground sm:text-[0.95rem]">{pain}</p>
            </li>
          ))}
        </ul>

        {/* The four converge into one. Lines draw as the section scrolls into view. */}
        <div aria-hidden="true" className="relative hidden h-28 lg:block">
          <svg viewBox="0 0 1000 112" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" fill="none">
            {[125, 375, 625, 875].map((x) => (
              <path
                key={x}
                d={`M${x} 0 C ${x} 60, 500 50, 500 112`}
                pathLength={1}
                stroke="url(#converge)"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
                className="mk-draw"
              />
            ))}
            <defs>
              <linearGradient id="converge" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--brand-teal)" stopOpacity="0.15" />
                <stop offset="100%" stopColor="var(--brand-teal)" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        <div aria-hidden="true" className="mx-auto h-12 w-px bg-gradient-to-b from-transparent to-brand-teal lg:hidden" />

        <div className="reveal-up flex flex-col items-center text-center">
          <span className="inline-flex items-center gap-3 rounded-full bg-card py-2 pr-5 pl-2 shadow-[0_0_0_1px_color-mix(in_oklab,var(--brand-teal)_40%,transparent),0_0_40px_-6px_color-mix(in_oklab,var(--brand-teal)_55%,transparent)]">
            <span className="inline-flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-teal to-brand-blue text-brand-navy">
              <Sparkles className="size-4" aria-hidden="true" />
            </span>
            <span className="font-semibold">One system, FlexicaAI</span>
          </span>
          <p className="mt-10 max-w-3xl text-[clamp(1.5rem,3vw,2.25rem)] leading-tight font-semibold tracking-[-0.03em] text-balance">
            The real cost is not the tools. It is the{" "}
            <span className="whitespace-nowrap">follow-up</span>{" "}
            <span className="mk-gradient-text">nobody got round to calling about.</span>
          </p>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- tour ---- */

/** A soft plate the tour's artwork sits on, so each scene reads as a product screen. */
function Scene({ children }: { children: ReactNode }) {
  return <div className="mk-card rounded-[1.75rem] p-5 sm:p-8">{children}</div>;
}

const TOUR: TourStep[] = [
  {
    label: "Book",
    title: "Patients book and reschedule on WhatsApp",
    body: "Booking confirmations, day-before reminders and cancellation notices go out on their own. Patients reply in plain words, and the system checks the diary before it answers them.",
    points: [
      "Confirmations and reminders send themselves",
      "Replies are checked against the diary first",
      "Nothing for the patient to install",
    ],
    link: { href: "/whatsapp-for-patients", label: "How WhatsApp works" },
    visual: (
      <Scene>
        <WhatsAppThread />
      </Scene>
    ),
  },
  {
    label: "Consult",
    title: "Speak the visit. The note writes itself.",
    body: "Record on a phone, tablet or laptop — no template, no form to click through. The note comes back structured, with anything the audio left unclear flagged rather than guessed at.",
    points: [
      "Complaint, findings and plan in their own fields",
      "Unclear audio is flagged, never guessed",
      "Nothing is final until a provider approves it",
    ],
    link: { href: "/ai-medical-scribe", label: "Inside the AI scribe" },
    visual: (
      <Scene>
        <ScribeFlow />
      </Scene>
    ),
  },
  {
    label: "Bill",
    title: "The bill is raised from the visit",
    body: "Priced services, discounts that wait for approval, numbered invoices and receipts, part payments and advances — printed the way your front desk already prints.",
    points: [
      "Numbered invoices and receipts",
      "Discounts count only once they are approved",
      "Part payments, advances and what is still owed",
    ],
    link: { href: "/billing-and-revenue", label: "Billing and revenue" },
    visual: (
      <Scene>
        <BillingVisual />
      </Scene>
    ),
  },
  {
    label: "Follow up",
    title: "The next visit books itself",
    body: "Note the next visit at the end of this one and the reminder schedules itself. The follow-up nobody got round to calling about is the revenue most practices quietly lose.",
    points: [
      "Next visit captured while the patient is still there",
      "The reminder goes out on WhatsApp on time",
      "Rebookings land straight in the diary",
    ],
    link: { href: "/contact", label: "See it with your own patients" },
    visual: (
      <Scene>
        <RecallVisual />
      </Scene>
    ),
  },
];

function Tour() {
  return (
    <section id="how" className="relative scroll-mt-24 border-y border-[var(--mk-line)] bg-muted/40 py-24 sm:py-32">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="How it works"
          title="One system for the whole day"
          lede="From the moment a patient books to the moment the next visit is booked — without the four disconnected tools most practices hold together by hand."
        />
        <div className="mt-12 lg:mt-6">
          <ProductTour steps={TOUR} />
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------- capabilities ---- */

function Capabilities() {
  return (
    <section id="features" className="scroll-mt-24 py-24 sm:py-32">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <SectionHeading
            align="left"
            eyebrow="What else it does"
            title="Everything a practice runs on"
            lede="The parts nobody puts on a brochure are the parts that decide whether a system survives its first busy Monday."
          />
          <div className="reveal-up shrink-0">
            <SecondaryButton href="/contact">Talk to us</SecondaryButton>
          </div>
        </div>
        <div className="mt-14">
          <FeatureBento />
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- specialties ---- */

const CORE = [
  "Patient records",
  "Appointments & queue",
  "The AI scribe engine",
  "WhatsApp messaging",
  "Recalls & reminders",
  "Invoices & receipts",
  "Payments & dues",
  "Revenue & expenses",
  "Roles & permissions",
  "Activity audit trail",
];

function Specialties() {
  return (
    <section id="specialties" className="scroll-mt-24 border-y border-[var(--mk-line)] bg-muted/40 py-24 sm:py-32">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-16 px-4 sm:px-6 lg:grid-cols-2">
        <div>
          <Statement
            eyebrow="Built to be more than one thing"
            lines={["One platform,", "shaped to", "your specialty"]}
            lede="Scheduling, records, messaging, billing and reporting are the same work in every practice, so we built them once and built them properly. The parts that do differ — the vocabulary, the note structure, the formulary and the follow-up intervals — live in a module on top."
            cta={{ href: "#security", label: "How your data is handled" }}
          />
        </div>

        {/* The architecture as a picture: the module slots on top, the shared core
            underneath. The core list stays a real list — it is content, not art. */}
        <div className="mk-reveal-scale relative">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center justify-between rounded-2xl bg-gradient-to-br from-brand-teal to-brand-blue px-5 py-4 text-brand-navy shadow-[0_18px_40px_-18px_color-mix(in_oklab,var(--brand-teal)_80%,transparent)]">
              <span className="font-semibold">Your specialty</span>
              <Layers className="size-4" aria-hidden="true" />
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-dashed border-[var(--mk-line-strong)] px-5 py-4 text-muted-foreground">
              <span className="font-medium">The next one</span>
              <Plus className="size-4" aria-hidden="true" />
            </div>
          </div>

          <div aria-hidden="true" className="mx-auto flex h-8 w-1/2 justify-between px-10">
            <span className="w-px bg-gradient-to-b from-brand-teal to-transparent" />
            <span className="w-px bg-gradient-to-b from-[var(--mk-line-strong)] to-transparent" />
          </div>

          <div className="mk-card overflow-hidden p-7">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                Shared by every practice
              </h3>
              <span className="rounded-full bg-brand-teal/12 px-2.5 py-1 font-mono text-3xs font-semibold text-primary-text">
                CORE
              </span>
            </div>
            <ul className="mt-6 grid gap-x-6 gap-y-3.5 sm:grid-cols-2">
              {CORE.map((item) => (
                <li key={item} className="flex items-center gap-2.5 text-[0.95rem]">
                  <BadgeCheck className="size-4 shrink-0 text-primary-text" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-7 border-t border-[var(--mk-line)] pt-5 text-sm leading-relaxed text-muted-foreground">
              Your team sees only what it actually uses. Adding a specialty later does not
              mean migrating to a different product.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- security ---- */

const SECURITY = [
  {
    Icon: ShieldCheck,
    title: "Separated by design",
    body: "Every record belongs to one practice, and every query is filtered by it in the server layer. The browser never talks to the database.",
  },
  {
    Icon: Fingerprint,
    title: "Only what the role needs",
    body: "Access is granted per person, per capability. A front-desk account does not see clinical notes unless you decide it should.",
  },
  {
    Icon: History,
    title: "Nothing is ever really deleted",
    body: "Deleting moves a record to a trash you can restore from, along with who did it and when. Every action has a name against it.",
  },
];

function Security() {
  return (
    <section id="security" data-motion-scope className="scroll-mt-24 px-4 py-24 sm:px-6 sm:py-32">
      <div className="mk-inverse ring-1 ring-white/10 relative isolate mx-auto w-full max-w-6xl overflow-hidden rounded-[2rem] px-5 py-16 sm:px-12 sm:py-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-40 -right-40 -z-10 h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(circle,var(--brand-teal)_0%,transparent_65%)] opacity-25 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-teal/60 to-transparent"
        />

        <div className="grid items-center gap-14 lg:grid-cols-2">
          <Statement
            eyebrow="Security"
            lines={["Patient data,", "treated like", "patient data"]}
            lede="Health records are the most sensitive thing a practice holds. The safeguards are structural, not settings someone has to remember to switch on."
            cta={{ href: "#how", label: "See how a note is made" }}
          />
          <SecurityVisual className="reveal-up" />
        </div>

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {SECURITY.map(({ Icon, title, body }) => (
            <FeatureCard key={title} Icon={Icon} title={title} body={body} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------- faq ---- */

/** Answers are statements about how the product works today — nothing on pricing or
 *  timelines, which are not published. */
const FAQ = [
  {
    q: "Does the AI write the medical record?",
    a: "No. It writes a draft. A provider reads it, edits anything that needs changing and approves it. Until then it is labelled a draft, and nothing is billed or sent from it.",
  },
  {
    q: "What happens when the recording is unclear?",
    a: "The note flags the part it could not make out so the provider can confirm it. It never fills the gap with a plausible-sounding guess.",
  },
  {
    q: "Do patients need to install anything?",
    a: "No. Confirmations, reminders and replies all happen in WhatsApp, which your patients already use every day.",
  },
  {
    q: "Can the front desk see clinical notes?",
    a: "Only if you decide they should. Access is granted per person and per capability, so each member of the team sees what their job needs.",
  },
  {
    q: "What if someone deletes something by mistake?",
    a: "Nothing is permanently deleted. It moves to a trash you can restore from, and the activity log shows who did it and when.",
  },
  {
    q: "Will it work with the printer we already have?",
    a: "Yes. Invoices and receipts print on a thermal roll, A5 or A4, so the front desk keeps the printer and the habit it already has.",
  },
  {
    q: "How do we get started?",
    a: "Message us on WhatsApp or send an email. We walk through FlexicaAI around how your practice books, records and bills, then set your account up for you.",
  },
];

function Faq() {
  return (
    <section id="faq" className="scroll-mt-24 pb-8 sm:pb-12">
      <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-20">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionHeading
            align="left"
            eyebrow="Questions"
            title="What practices ask us first"
            lede="Anything else, ask us directly — a real person answers."
          />
          <div className="reveal-up mt-8">
            <SecondaryButton href={SALES_WHATSAPP_URL} icon={<WhatsAppIcon className="size-4 text-whatsapp-fg" />}>
              Ask on WhatsApp
            </SecondaryButton>
          </div>
        </div>

        <div className="divide-y divide-[var(--mk-line)] border-y border-[var(--mk-line)]">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="mk-faq group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-6 text-left text-lg font-semibold tracking-[-0.01em] transition-colors hover:text-primary-text">
                {q}
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full shadow-[0_0_0_1px_var(--mk-line-strong)] transition-all duration-300 group-open:rotate-45 group-open:bg-brand-teal group-open:text-brand-navy group-open:shadow-none">
                  <Plus className="size-4" aria-hidden="true" />
                </span>
              </summary>
              <p className="max-w-2xl pr-14 pb-6 text-[1.02rem] leading-relaxed text-muted-foreground">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
