import type { Metadata } from "next";
import Link from "next/link";
import { Mail, MessageSquare, Phone, Stethoscope } from "lucide-react";
import { FeatureCard, PageHero, SectionHeading } from "../sections";
import { ContactVisual } from "../contact-visual";
import { WhatsAppIcon } from "../whatsapp-icon";
import { Magnetic } from "../magnetic";
import { WhatsAppCta } from "../whatsapp-cta";
import {
  SALES_EMAIL,
  SALES_EMAIL_URL,
  SALES_PHONE_DISPLAY,
  SALES_WHATSAPP_URL,
} from "../contact";
import { ORGANIZATION, ORIGIN, ORG_ID } from "../structured-data";

/**
 * Contact.
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
    Icon: Mail,
    title: "Last month's numbers",
    body: "Whatever you use to track money now. We will show you where the same figures come from, including the ones that are currently hard to get at.",
  },
];

export default function ContactPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
      />

      <PageHero
        eyebrow="Contact"
        lines={["Tell us how", "your practice", "actually runs."]}
        lede="No form to fill in and nothing to install. Message us on WhatsApp, send an email, or call, and we will set up a walkthrough around how your clinic really works."
        art={<ContactVisual className="reveal-up" />}
        artFirst
      />

      {/* The three channels, as real links rather than decoration. */}
      <section className="border-y border-foreground/10 bg-muted/40 py-12 sm:py-16">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="grid gap-5 md:grid-cols-3">
            <a
              href={SALES_WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group reveal-up rounded-2xl bg-card p-6 ring-1 ring-foreground/10 transition-all hover:-translate-y-1 hover:ring-[#25d366]/50"
            >
              <span className="inline-flex size-10 items-center justify-center rounded-xl bg-[#25d366]/15 text-[#128c4a] ring-1 ring-[#25d366]/30 transition-transform group-hover:scale-110 dark:text-[#4ade80]">
                <WhatsAppIcon className="size-5" />
              </span>
              <h2 className="mt-5 font-heading text-lg font-medium">WhatsApp</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                The fastest way to reach us. Voice notes are fine.
              </p>
              <p className="mt-3 font-mono text-sm text-foreground">{SALES_PHONE_DISPLAY}</p>
            </a>

            <a
              href={SALES_EMAIL_URL}
              className="group reveal-up rounded-2xl bg-card p-6 ring-1 ring-foreground/10 transition-all hover:-translate-y-1 hover:ring-primary/40"
            >
              <span className="inline-flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20 transition-transform group-hover:scale-110">
                <Mail className="size-5" />
              </span>
              <h2 className="mt-5 font-heading text-lg font-medium">Email</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Better for longer questions, or if you want it in writing.
              </p>
              <p className="mt-3 font-mono text-sm break-all text-foreground">{SALES_EMAIL}</p>
            </a>

            <a
              href={`tel:${SALES_PHONE_DISPLAY.replace(/\s/g, "")}`}
              className="group reveal-up rounded-2xl bg-card p-6 ring-1 ring-foreground/10 transition-all hover:-translate-y-1 hover:ring-primary/40"
            >
              <span className="inline-flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20 transition-transform group-hover:scale-110">
                <Phone className="size-5" />
              </span>
              <h2 className="mt-5 font-heading text-lg font-medium">Phone</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                If you would rather just talk it through.
              </p>
              <p className="mt-3 font-mono text-sm text-foreground">{SALES_PHONE_DISPLAY}</p>
            </a>
          </div>
        </div>
      </section>

      <section className="py-12 sm:py-16">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="Before the demo"
            title="Worth having to hand"
            lede="None of this is required. It just turns a product tour into a conversation about your practice."
          />
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {BRING.map((c) => (
              <FeatureCard key={c.title} {...c} />
            ))}
          </div>

          <div className="reveal-up mt-12 rounded-2xl bg-card p-8 text-center ring-1 ring-foreground/10">
            <h2 className="font-heading text-2xl font-semibold tracking-tight">
              Already using FlexicaAI?
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
              Support runs through the same channels. Message us and say which practice
              you are with so we can pull up the right account.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Magnetic>
                <WhatsAppCta ping>Message us on WhatsApp</WhatsAppCta>
              </Magnetic>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-medium ring-1 ring-foreground/15 transition-colors hover:bg-foreground/5"
              >
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
