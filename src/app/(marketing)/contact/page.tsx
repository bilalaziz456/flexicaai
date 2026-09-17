import type { Metadata } from "next";
import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  BarChart3,
  KeyRound,
  LifeBuoy,
  Mail,
  MessageSquare,
  MonitorPlay,
  Phone,
  Stethoscope,
} from "lucide-react";
import { SectionHeading, Statement } from "../sections";
import { CapabilityHero, CapabilityList, Pipeline, type PipelineStep } from "../ai-kit";
import { ContactHeroArt } from "../contact-hero-art";
import { WhatsAppIcon } from "../whatsapp-icon";
import { Magnetic } from "../magnetic";
import { WhatsAppCta } from "../whatsapp-cta";
import {
  SALES_EMAIL,
  SALES_EMAIL_URL,
  SALES_PHONE_DISPLAY,
  SALES_WHATSAPP_URL,
} from "../contact-details";
import { ORGANIZATION, ORIGIN, ORG_ID } from "../structured-data";

/**
 * Contact — built in the same shape as the capability pages (split hero with a live
 * composition, a connected flow, a hairline list, a navy panel), so the site reads as
 * one product from the first page to the last.
 *
 * Story: the first conversation (hero) → the three real channels → what happens after
 * you reach out → what is worth having to hand → existing customers.
 *
 * No enquiry form on purpose. There is no public signup and no leads table, so a form
 * would either need a new schema and mail pipeline, or would silently go nowhere —
 * and a contact form that drops messages is worse than no form. WhatsApp and email
 * are real channels that already work, and WhatsApp is what this market answers on.
 *
 * Nothing here promises a response time, publishes office hours or gives an address.
 * We have none of those agreed, and a page whose whole purpose is to start an honest
 * conversation is a poor place to invent them.
 */

const TITLE = "Contact FlexicaAI: book a demo | FlexicaAI";
const DESCRIPTION =
  "Talk to us about FlexicaAI. Message us on WhatsApp, send an email, or call. We will walk you through the product set up the way your practice would use it.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/contact" },
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", siteName: "FlexicaAI" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

/** A ContactPage node, so the contact route is machine-identifiable as one. */
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    ORGANIZATION,
    {
      "@type": "ContactPage",
      "@id": `${ORIGIN}/contact#webpage`,
      url: `${ORIGIN}/contact`,
      name: "Contact FlexicaAI",
      description: DESCRIPTION,
      isPartOf: { "@id": `${ORIGIN}/#website` },
      publisher: { "@id": ORG_ID },
      inLanguage: "en",
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: ORIGIN },
        { "@type": "ListItem", position: 2, name: "Contact", item: `${ORIGIN}/contact` },
      ],
    },
  ],
};

const NEXT_STEPS: PipelineStep[] = [
  {
    Icon: MessageSquare,
    title: "You message us",
    body: "On WhatsApp, by email or by phone — a line is enough, and voice notes are fine.",
  },
  {
    Icon: Stethoscope,
    title: "We learn how you work",
    body: "Who books a visit, who writes it up, who bills it. We ask before we show anything.",
  },
  {
    Icon: MonitorPlay,
    title: "A walkthrough, your way",
    body: "You see FlexicaAI set up around your own sequence, not a generic demo practice.",
  },
  {
    Icon: KeyRound,
    title: "We set you up",
    body: "There is no sign-up form. We create your practice and your team’s logins for you.",
  },
];

const BRING = [
  {
    Icon: Stethoscope,
    title: "How a visit runs today",
    body: "Who books it, who records it, who bills it. The walkthrough is far more useful when it follows your actual sequence rather than our demo one.",
  },
  {
    Icon: MessageSquare,
    title: "A consultation to try",
    body: "A recording, or just talk one through with us. Seeing the scribe draft a note from your own words answers more questions than any slide.",
  },
  {
    Icon: BarChart3,
    title: "Last month’s numbers",
    body: "Whatever you use to track money now. We will show you where the same figures come from, including the ones that are currently hard to get at.",
  },
];

/** One channel: a real link, with the value on it and an action that says what happens. */
function Channel({
  href,
  external,
  Icon,
  title,
  body,
  value,
  action,
  featured,
}: {
  href: string;
  external?: boolean;
  Icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
  value: string;
  action: string;
  featured?: boolean;
}) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className={`group reveal-up mk-card mk-card-hover relative flex flex-col overflow-hidden p-7 sm:p-8 ${featured ? "lg:row-span-2" : ""}`}
    >
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute -top-24 -right-24 size-64 rounded-full blur-3xl transition-opacity duration-500 ${
          featured ? "bg-whatsapp/25 opacity-100" : "bg-brand-teal/20 opacity-0 group-hover:opacity-100"
        }`}
      />
      <span
        className={`relative inline-flex size-12 items-center justify-center rounded-2xl transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-105 ${
          featured ? "bg-whatsapp text-brand-navy shadow-[0_12px_30px_-10px_var(--whatsapp)]" : "bg-brand-teal/12 text-primary-text"
        }`}
      >
        <Icon className="size-5" />
      </span>
      {featured ? (
        <span className="relative mt-6 w-fit rounded-full bg-whatsapp/12 px-2.5 py-1 text-3xs font-semibold tracking-[0.12em] text-whatsapp-fg uppercase">
          Fastest
        </span>
      ) : null}
      <h3 className={`relative ${featured ? "mt-3 text-3xl font-bold tracking-[-0.03em]" : "mk-h3 mt-6"}`}>{title}</h3>
      <p className="relative mt-2.5 text-[0.95rem] leading-relaxed text-muted-foreground">{body}</p>
      <p className={`relative mt-5 font-mono break-all text-foreground ${featured ? "text-lg" : "text-sm"}`}>{value}</p>
      {featured ? (
        // What the button actually sends — the pre-filled greeting, so there is nothing
        // to type. Decorative preview; the link itself is the whole card.
        <div aria-hidden="true" className="relative mt-6 rounded-2xl bg-[#efeae2] p-4 dark:bg-[#0b141a]">
          <p className="ml-auto w-fit max-w-[90%] rounded-2xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 text-sm text-[#111b21] shadow-[0_1px_1px_rgb(0_0_0/0.08)] dark:bg-[#005c4b] dark:text-[#e9edef]">
            Hi FlexicaAI, I would like to see a demo.
          </p>
          <p className="mt-2 text-right text-3xs text-muted-foreground">Already typed for you — just press send</p>
        </div>
      ) : null}
      <span className="relative mt-auto inline-flex items-center gap-1.5 pt-6 text-sm font-semibold text-primary-text">
        <span className="mk-link">{action}</span>
        <ArrowUpRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
      </span>
    </a>
  );
}

/** A sample support message, so "say which practice you are with" is shown, not told. */
function SupportSample({ children }: { children: ReactNode }) {
  return (
    <div aria-hidden="true" className="reveal-up mk-card space-y-3 rounded-[1.75rem] p-6 sm:p-8">
      <p className="text-3xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">A good support message</p>
      <div className="flex justify-end">
        <p className="max-w-[88%] rounded-2xl rounded-tr-sm bg-[#d9fdd3] px-3.5 py-2.5 text-sm leading-snug text-[#111b21] shadow-[0_1px_1px_rgb(0_0_0/0.08)] dark:bg-[#005c4b] dark:text-[#e9edef]">
          {children}
        </p>
      </div>
      <ul className="space-y-2 border-t border-[var(--mk-line)] pt-4 text-sm text-muted-foreground">
        <li className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-brand-teal" /> Which practice you are with
        </li>
        <li className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-brand-teal" /> What you were trying to do
        </li>
        <li className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-brand-teal" /> A screenshot, if something looks wrong
        </li>
      </ul>
    </div>
  );
}

export default function ContactPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
      />

      <CapabilityHero
        eyebrow="Contact"
        lines={["Tell us how", "your practice", "actually runs."]}
        lede="No form to fill in and nothing to install. Message us on WhatsApp, send an email, or call, and we will set up a walkthrough around how your clinic really works."
        secondary={{ href: "#ways-to-reach-us", label: "Ways to reach us" }}
        art={<ContactHeroArt />}
      />

      <section
        id="ways-to-reach-us"
        aria-labelledby="contact-channels"
        className="scroll-mt-24 border-y border-[var(--mk-line)] bg-muted/40 py-24 sm:py-32"
      >
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="reveal-up mx-auto max-w-3xl text-center">
            <h2 id="contact-channels" className="mk-h2">
              Pick whichever is easiest
            </h2>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-pretty text-muted-foreground">
              Every one of these reaches a person on our team. WhatsApp is usually quickest.
            </p>
          </div>

          <div className="mt-14 grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <Channel
              featured
              href={SALES_WHATSAPP_URL}
              external
              Icon={WhatsAppIcon}
              title="WhatsApp"
              body="The fastest way to reach us, and the easiest place to send a voice note or a screenshot."
              value={SALES_PHONE_DISPLAY}
              action="Open WhatsApp"
            />
            <Channel
              href={SALES_EMAIL_URL}
              Icon={Mail}
              title="Email"
              body="Better for longer questions, or if you want it in writing."
              value={SALES_EMAIL}
              action="Write an email"
            />
            <Channel
              href={`tel:${SALES_PHONE_DISPLAY.replace(/\s/g, "")}`}
              Icon={Phone}
              title="Phone"
              body="If you would rather just talk it through."
              value={SALES_PHONE_DISPLAY}
              action="Call us"
            />
          </div>
        </div>
      </section>

      <section className="py-24 sm:py-32">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="What happens next"
            title="From a first message to your practice, set up"
            lede="No sales script and no generic demo. Four steps, and the first one is a single message."
          />
          <div className="mt-16">
            <Pipeline steps={NEXT_STEPS} />
          </div>
        </div>
      </section>

      <section className="border-y border-[var(--mk-line)] bg-muted/40 py-24 sm:py-32">
        <div className="mx-auto grid w-full max-w-6xl gap-14 px-4 sm:px-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-20">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <SectionHeading
              align="left"
              eyebrow="Before the demo"
              title="Worth having to hand"
              lede="None of this is required. It just turns a product tour into a conversation about your practice."
            />
          </div>
          <CapabilityList title="Bring if you can" items={BRING} />
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
            <div>
              <Statement
                eyebrow="Already a customer"
                lines={["Support runs", "through the", "same channels."]}
                lede="Message us and say which practice you are with, so we can pull up the right account straight away."
              />
              <div className="reveal-up mt-9 flex flex-wrap items-center gap-3">
                <Magnetic>
                  <WhatsAppCta ping>Message us on WhatsApp</WhatsAppCta>
                </Magnetic>
                <Link
                  href="/login"
                  className="group inline-flex h-12 items-center gap-2 rounded-full bg-card/60 px-5 text-[0.95rem] font-medium text-foreground shadow-[0_0_0_1px_var(--mk-line-strong)] backdrop-blur transition-[background-color,transform] duration-300 hover:-translate-y-0.5 hover:bg-card"
                >
                  <LifeBuoy className="size-4 text-muted-foreground" aria-hidden="true" />
                  Sign in
                </Link>
              </div>
            </div>
            <SupportSample>
              Hi, this is Noor Family Practice. Today’s reminders don’t seem to have gone out — can you check?
            </SupportSample>
          </div>
        </div>
      </section>
    </>
  );
}
