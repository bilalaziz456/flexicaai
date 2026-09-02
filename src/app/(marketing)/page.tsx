import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  BadgeCheck,
  CalendarClock,
  ClipboardCheck,
  Fingerprint,
  History,
  Mail,
  Mic,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { HeroVisual } from "./hero-visual";
import { HeroParallax } from "./hero-parallax";
import { ScribeFlow } from "./scribe-flow";
import { SecurityVisual } from "./security-visual";
import { Magnetic } from "./magnetic";
import { WhatsAppCta } from "./whatsapp-cta";
import { WhatsAppIcon } from "./whatsapp-icon";
import { SALES_EMAIL, SALES_EMAIL_URL } from "./contact-details";
import { FeatureCard, SectionHeading, Statement } from "./sections";
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
 * something the product actually does today.
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
      <Capabilities />
      <HowItWorks />
      <Specialties />
      <Security />
      <ClosingCta />
    </>
  );
}

/* ---------------------------------------------------------------- hero ---- */

function Hero() {
  return (
    <section data-motion-scope className="relative overflow-hidden">
      {/* Circuit-grid backdrop, drifting. The mask fades it out before it reaches the
          copy; the grid itself is oversized so the drift never exposes an edge. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden [mask-image:radial-gradient(ellipse_at_top,black,transparent_72%)]"
      >
        <div className="absolute -inset-x-20 -inset-y-20 bg-[linear-gradient(to_right,var(--color-foreground)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-foreground)_1px,transparent_1px)] bg-[size:56px_56px] opacity-[0.04] motion-safe:animate-grid-drift" />
      </div>

      {/* Breathing brand glow. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-[38rem] w-[68rem] -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,var(--brand-teal)_0%,transparent_65%)] opacity-[0.13] blur-3xl motion-safe:animate-aurora dark:opacity-20"
      />

      {/* Scanner pass — a wide, very faint beam crossing the hero. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="h-full w-1/4 bg-[linear-gradient(90deg,transparent,var(--brand-teal),transparent)] opacity-0 blur-2xl motion-safe:animate-scan-x motion-safe:opacity-[0.07] dark:motion-safe:opacity-[0.12]" />
      </div>

      {/* Padding matches PageHero so the homepage opens at the same height as every
          feature page. (The copy column is the taller of the two, so `items-center`
          centres the ARTWORK against it — it was never pushing the copy down.) */}
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pt-12 pb-14 sm:px-6 lg:grid-cols-2 lg:pt-16 lg:pb-20">
        <div>
          {/* The kicker lives INSIDE the h1 on purpose. It was a separate pill above
              it, which looked identical but sat outside the heading, so the only words
              in our most weighted element were brand voice — "Spend your day on care"
              is a good line that nobody searches for. Folding the pill in puts the
              term people do search into the h1 at no visual cost. */}
          <h1 className="text-[clamp(2.6rem,7vw,4.6rem)] leading-[0.95] font-semibold tracking-[-0.035em] text-balance">
            {/* `flex w-fit`, not `inline-flex`. As an inline box this sat inside the
                h1's own line box, and the h1 is 73px with ~70px line-height, so the
                pill was trapped in a 70px-tall line and carried 46px of dead space
                above it — the headline sat far lower than on any other page. As a
                block-level box it gets its own height and `mb` is the only gap. */}
            <span className="mb-5 flex w-fit items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs leading-none font-medium tracking-normal text-brand-navy ring-1 ring-primary/25 dark:text-brand-teal">
              <Sparkles className="size-3.5" aria-hidden="true" />
              AI-powered health management system
            </span>

            <span className="block">
              Spend your day on care,{" "}
              {/* The brand gradient ends on navy, which is near-invisible on a dark
                  background, so in dark mode it stops at blue and stays legible. */}
              <span className="bg-gradient-to-r from-brand-teal via-brand-blue to-brand-navy bg-clip-text text-transparent dark:to-brand-blue">
                not paperwork
              </span>
            </span>
          </h1>

          <p className="mt-6 max-w-xl text-lg text-pretty text-muted-foreground">
            FlexicaAI listens to the consultation and drafts the note, keeps patients
            coming back over WhatsApp, and shows you exactly where the money goes. Your
            team gets to run the practice instead of chasing it.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Magnetic>
              <WhatsAppCta ping>Book a demo on WhatsApp</WhatsAppCta>
            </Magnetic>
            <a
              href={SALES_EMAIL_URL}
              className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-medium ring-1 ring-foreground/15 transition-colors hover:bg-foreground/5"
            >
              <Mail className="size-4" aria-hidden="true" />
              Email us
            </a>
          </div>

          <p className="mt-5 text-sm text-muted-foreground">
            Already a customer?{" "}
            {/* inline-flex + py-1: vertical padding on a bare inline <a> does not add
                to layout height, so this measured 43.6x17.6 and missed the 24px
                minimum target (WCAG 2.5.8). */}
            <Link
              href="/login"
              className="inline-flex items-center py-1 font-medium text-foreground underline-offset-4 hover:underline"
            >
              Sign in
            </Link>
          </p>
        </div>

        {/* Entirely server-rendered. The wrapper only publishes the pointer position
            for the layers to lean on, so with no JS the artwork is complete and
            simply sits centred. */}
        <HeroParallax className="relative mx-auto w-full max-w-lg">
          <HeroVisual />
        </HeroParallax>
      </div>

      <ValueStrip />
    </section>
  );
}

/** Four plain capability facts — deliberately not fabricated customer metrics. */
const VALUES = [
  { Icon: Mic, text: "Notes drafted while you speak" },
  { Icon: BadgeCheck, text: "Nothing final until a provider approves" },
  { Icon: WhatsAppIcon, text: "Patients need no app, just WhatsApp" },
  { Icon: ShieldCheck, text: "Every practice's data kept separate" },
];

function ValueStrip() {
  return (
    <div className="relative border-y border-foreground/10 bg-muted/40">
      <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        {VALUES.map(({ Icon, text }) => (
          <div key={text} className="flex items-start gap-3">
            <Icon className="mt-0.5 size-5 shrink-0 text-primary-text" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">{text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------- capabilities ---- */

const CAPABILITIES = [
  {
    Icon: Mic,
    title: "The AI scribe",
    body: "Record the consultation on any device. It comes back as a structured note with the findings, the plan and the prescription, ready for you to read. The draft is never the record. A provider edits it and approves it before anything is saved.",
  },
  {
    Icon: WhatsAppIcon,
    title: "WhatsApp that works for you",
    body: "Booking confirmations, day-before reminders and cancellation notices go out on their own. Patients can reply to book or reschedule, and the system checks the diary before it answers them.",
  },
  {
    Icon: RefreshCw,
    title: "Recalls that bring people back",
    body: "Note the next visit at the end of this one and the reminder schedules itself. That follow-up nobody got round to calling about is the revenue most practices quietly lose.",
  },
  {
    Icon: CalendarClock,
    title: "Scheduling that respects reality",
    body: "Working hours per provider, split shifts, leave, daily limits and a first-come queue number. If a booking breaks one of your rules, it tells you instead of double-booking someone.",
  },
  {
    Icon: Receipt,
    title: "Billing, end to end",
    body: "Priced services, line-item discounts that need approval, numbered invoices and receipts, part payments, advances and what is still owed. It all prints the way your front desk already prints.",
  },
  {
    Icon: Wallet,
    title: "Where the money actually went",
    body: "Revenue earned, what each provider is owed and has been paid, expenses and profit. It comes from the records your team already keeps, so there is no second spreadsheet to reconcile.",
  },
];

function Capabilities() {
  return (
    <section id="features" className="scroll-mt-20 py-12 sm:py-16">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="What it does"
          title="One system for the whole day"
          lede="From the moment a patient books to the moment the money lands, without the four disconnected tools most practices are holding together by hand."
        />

        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {/* No per-card stagger: `animation-delay` is meaningless on a scroll-driven
              timeline (position in the range is what drives it, not elapsed time), and
              a grid already staggers itself row by row as each row enters view. */}
          {CAPABILITIES.map(({ Icon, title, body }) => (
            <FeatureCard key={title} Icon={Icon} title={title} body={body} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------- how it works ---- */

const STEPS = [
  {
    Icon: Mic,
    title: "Speak",
    body: "See the patient the way you always do. Just hit record on a phone, tablet or laptop. There is no template to fill in and no form to click through while you are with them.",
  },
  {
    Icon: ClipboardCheck,
    title: "Review",
    body: "The note comes back structured. Anything the audio left unclear is flagged rather than guessed at. You fix what needs fixing and approve it. Until you do, it stays a draft.",
  },
  {
    Icon: Activity,
    title: "It carries on without you",
    body: "The note is filed, the prescription is ready to print or send, the bill is raised, and the follow-up is booked. The patient gets reminded about it automatically.",
  },
];

function HowItWorks() {
  return (
    <section id="how" data-motion-scope className="scroll-mt-20 border-y border-foreground/10 bg-muted/40 py-12 sm:py-16">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        {/* Artwork left, words right — but the WORDS stay first in the DOM and are
            reordered visually only from `lg` up. Stacked on a phone the heading should
            still come before the illustration, and that is also the order a screen
            reader and a crawler read it in. */}
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div className="lg:order-2">
            <Statement
              eyebrow="How it works"
              lines={["Three steps,", "and only one", "is yours"]}
              lede="The AI drafts and a human decides. That order never changes. Nothing clinical is finalised until a provider has approved it, and a draft is never quietly turned into the record behind your back."
              cta={{ href: "#features", label: "See everything it does" }}
            />
          </div>
          <ScribeFlow className="reveal-up lg:order-1" />
        </div>

        <div className="relative mt-10">
          {/* The steps, in a row. */}
          <ol className="relative grid gap-6 md:grid-cols-3">
            {STEPS.map(({ Icon, title, body }, i) => (
              <FeatureCard
                key={title}
                as="li"
                Icon={Icon}
                title={title}
                body={body}
                eyebrow={`STEP ${i + 1}`}
                // Each step's ring fires a second after the one before, so the pulse
                // visibly travels 1 → 2 → 3.
                pingDelay={`${i * 1000}ms`}
              />
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- specialties ---- */

function Specialties() {
  return (
    <section id="specialties" className="scroll-mt-20 py-12 sm:py-16">
      <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:items-center">
        <div>
          <Statement
            eyebrow="Built to be more than one thing"
            lines={["One platform,", "shaped to", "your specialty"]}
            lede="Scheduling, records, messaging, billing and reporting are the same work in every practice, so we built them once and built them properly. The parts that do differ, like the vocabulary, the note structure, the formulary and the follow-up intervals, live in a module that sits on top."
            cta={{ href: "#security", label: "How your data is handled" }}
          />
          <p className="mt-6 max-w-xl text-muted-foreground">
            Your team sees only what it actually uses. Adding a specialty later does not
            mean migrating to a different product.
          </p>
        </div>

        <div className="reveal-up relative overflow-hidden rounded-2xl bg-card p-8 ring-1 ring-foreground/10">
          {/* Slow scanner pass over the shared-core list — it reads as the platform
              enumerating itself. */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            <div className="h-full w-1/3 bg-[linear-gradient(90deg,transparent,var(--brand-teal),transparent)] opacity-[0.06] blur-2xl motion-safe:animate-scan-x dark:opacity-10" />
          </div>
          <h3 className="relative font-heading text-sm font-medium tracking-widest text-muted-foreground uppercase">
            Shared by every practice
          </h3>
          <ul className="relative mt-5 grid gap-3 sm:grid-cols-2">
            {[
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
            ].map((item) => (
              <li key={item} className="flex items-center gap-2.5 text-sm">
                <BadgeCheck className="size-4 shrink-0 text-primary-text" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
          <p className="relative mt-6 border-t border-foreground/10 pt-5 text-sm text-muted-foreground">
            Specialty modules layer on top of all of it. They are never a separate
            system for you to keep in sync.
          </p>
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
    body: "Deleting moves a record to a trash you can restore from, along with who did it and when. With the full activity log beside it, mistakes can be undone and every action has a name against it.",
  },
];

function Security() {
  return (
    <section
      id="security"
      className="scroll-mt-20 border-y border-foreground/10 bg-muted/40 py-12 sm:py-16"
    >
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <Statement
            eyebrow="Security"
            lines={["Patient data,", "treated like", "patient data"]}
            lede="Health records are the most sensitive thing a practice holds. The safeguards are structural, not settings someone has to remember to switch on."
            cta={{ href: "#how", label: "See how a note is made" }}
          />
          <SecurityVisual className="reveal-up" />
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {SECURITY.map(({ Icon, title, body }) => (
            <FeatureCard key={title} Icon={Icon} title={title} body={body} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ closing cta ---- */

function ClosingCta() {
  return (
    <section data-motion-scope className="relative overflow-hidden py-12 sm:py-16">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,var(--brand-teal)_0%,transparent_62%)] opacity-[0.12] blur-3xl motion-safe:animate-aurora dark:opacity-20"
      />
      <div className="reveal-up mx-auto w-full max-w-3xl px-4 text-center sm:px-6">
        <h2 className="font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          See it on your own workflow
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-lg text-pretty text-muted-foreground">
          Send us a message and we will walk you through it with your own practice in
          mind: how you book, how you chart, how you bill. No obligation.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Magnetic>
            <WhatsAppCta ping>Book a demo on WhatsApp</WhatsAppCta>
          </Magnetic>
          <a
            href={SALES_EMAIL_URL}
            className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-medium ring-1 ring-foreground/15 transition-colors hover:bg-foreground/5"
          >
            <Mail className="size-4" aria-hidden="true" />
            {SALES_EMAIL}
          </a>
        </div>
      </div>
    </section>
  );
}
