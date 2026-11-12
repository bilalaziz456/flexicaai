import { PHONES, SALES_EMAIL } from "./contact";

/**
 * Site-wide identity and search data.
 *
 * Deliberately no `aggregateRating`, `review` or `offers` in any structured data: there
 * are no public ratings and no published price, and inventing them is both untrue and
 * penalised by search engines.
 */

export const ORIGIN = "https://www.flexicaai.com";
export const SITE_NAME = "FlexicaAI";
export const ORG_ID = `${ORIGIN}/#organization`;
export const WEBSITE_ID = `${ORIGIN}/#website`;
export const SOFTWARE_ID = `${ORIGIN}/#software`;

/** Home page title: under ~60 characters, the search terms first. */
export const HOME_TITLE = "Clinic Management Software with AI Scribe | FlexicaAI";

/** Under ~155 characters so results do not cut it off. */
export const HOME_DESCRIPTION =
  "FlexicaAI is clinic management software for Pakistan: appointments, patient records, WhatsApp, an AI clinical scribe, billing and P&L.";

/** One-line company description used in the footer and the Organization node. */
export const COMPANY_BLURB =
  "FlexicaAI is an intelligent clinic platform for clinics in Pakistan — appointments, patient records, WhatsApp communication, AI-assisted clinical notes, billing and financial reporting in one place.";

export const SOCIAL_LINKS = [
  { id: "facebook", label: "Facebook", url: "https://www.facebook.com/FlexicaAIOfficial" },
  { id: "instagram", label: "Instagram", url: "https://www.instagram.com/flexicaaiofficial" },
  { id: "linkedin", label: "LinkedIn", url: "https://www.linkedin.com/company/138694703" },
] as const;

export const ORGANIZATION = {
  "@type": "Organization",
  "@id": ORG_ID,
  name: SITE_NAME,
  url: ORIGIN,
  logo: `${ORIGIN}/logo.svg`,
  description: COMPANY_BLURB,
  sameAs: SOCIAL_LINKS.map((s) => s.url),
  areaServed: [{ "@type": "Country", name: "Pakistan" }],
  contactPoint: PHONES.map((p) => ({
    "@type": "ContactPoint",
    contactType: "sales",
    telephone: p.tel,
    email: SALES_EMAIL,
    availableLanguage: ["English", "Urdu"],
  })),
};

export const WEBSITE = {
  "@type": "WebSite",
  "@id": WEBSITE_ID,
  url: ORIGIN,
  name: SITE_NAME,
  publisher: { "@id": ORG_ID },
  inLanguage: "en",
};

export const SOFTWARE_APPLICATION = {
  "@type": "SoftwareApplication",
  "@id": SOFTWARE_ID,
  name: SITE_NAME,
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "Clinic management software",
  operatingSystem: "Web browser",
  url: ORIGIN,
  description: HOME_DESCRIPTION,
  publisher: { "@id": ORG_ID },
  featureList: [
    "Patient records and medical history",
    "Appointment scheduling and doctor schedules",
    "WhatsApp booking, confirmations, reminders and rescheduling",
    "AI clinical scribe that drafts structured notes for clinician approval",
    "Treatment plans, estimates and prescriptions",
    "Invoices, receipts, payments and deposits",
    "Sales, expenses, doctor revenue shares and profit and loss",
    "Patient recalls",
    "Role-based permissions, activity log and restorable trash",
  ],
};

export type Crumb = { name: string; path: string };

export function breadcrumbJsonLd(crumbs: Crumb[]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: `${ORIGIN}${c.path === "/" ? "" : c.path}`,
    })),
  };
}

/** A page's WebPage node plus its breadcrumb, tied to the one Organization/WebSite. */
export function pageJsonLd({
  path,
  name,
  description,
  crumbs,
  extra = [],
}: {
  path: string;
  name: string;
  description: string;
  crumbs: Crumb[];
  extra?: object[];
}) {
  const url = `${ORIGIN}${path}`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      ORGANIZATION,
      WEBSITE,
      {
        "@type": "WebPage",
        "@id": `${url}#webpage`,
        url,
        name,
        description,
        isPartOf: { "@id": WEBSITE_ID },
        about: { "@id": SOFTWARE_ID },
        inLanguage: "en",
      },
      breadcrumbJsonLd(crumbs),
      ...extra,
    ],
  };
}

/** Builds per-page metadata with canonical, Open Graph and X cards in one place. */
export function pageMetadata({
  title,
  description,
  path,
  type = "website",
}: {
  title: string;
  description: string;
  path: string;
  type?: "website" | "article";
}) {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: path, type, siteName: SITE_NAME, locale: "en_PK" },
    twitter: { card: "summary_large_image" as const, title, description },
  };
}

/** Questions answered on the home page — statements about how the product works today. */
export const FAQ = [
  {
    q: "Does the AI write the medical record?",
    a: "No. The AI clinical scribe writes a draft. The doctor who dictated it reads it, edits anything that needs changing and approves it. Until then it is clearly labelled a draft.",
  },
  {
    q: "What happens when the recording is unclear?",
    a: "The note flags the part it could not make out so the doctor can confirm it. It does not fill the gap with a plausible-sounding guess.",
  },
  {
    q: "Do patients need to install an app?",
    a: "No. Booking requests, confirmations, day-before reminders, rescheduling and recalls all happen in WhatsApp, which your patients already use.",
  },
  {
    q: "Can the front desk see clinical notes?",
    a: "Only if you decide they should. Access is granted per person and per capability, so each member of the team sees what their job needs.",
  },
  {
    q: "What if someone deletes something by mistake?",
    a: "Nothing is permanently deleted. It moves to a trash you can restore from, and the activity log shows who did what and when.",
  },
  {
    q: "Will it work with the printer we already have?",
    a: "Yes. Invoices and receipts print on a thermal roll, A5 or A4, and prescriptions print on your clinic's own letterhead.",
  },
  {
    q: "How do we get started?",
    a: "Book a demo, message us on WhatsApp or send an email. We walk through FlexicaAI around how your clinic books, records and bills, then set your account up for you.",
  },
];

export const FAQ_JSON_LD = {
  "@type": "FAQPage",
  "@id": `${ORIGIN}/#faq`,
  mainEntity: FAQ.map(({ q, a }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: a },
  })),
};
