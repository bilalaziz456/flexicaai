/**
 * The site's information architecture in one place: header, footer, sitemap and the
 * features hub all read from here, so no link can point at a page that is not built.
 */

export type FeatureSlug =
  | "patient-management"
  | "appointment-management"
  | "ai-scribe"
  | "whatsapp-integration"
  | "clinic-analytics"
  | "billing-and-payments";

export const FEATURE_LINKS: { slug: FeatureSlug; name: string; short: string }[] = [
  {
    slug: "patient-management",
    name: "Patient Management",
    short: "Records, medical history, attachments, treatment plans and prescriptions.",
  },
  {
    slug: "appointment-management",
    name: "Appointment Management",
    short: "Doctor calendars, working hours, daily caps, leave and the live queue.",
  },
  {
    slug: "ai-scribe",
    name: "AI Clinical Scribe",
    short: "Dictate the consultation; review and approve a structured draft note.",
  },
  {
    slug: "whatsapp-integration",
    name: "WhatsApp Integration",
    short: "Booking requests, confirmations, reminders, rescheduling and recalls.",
  },
  {
    slug: "clinic-analytics",
    name: "Clinic Analytics",
    short: "Sales, expenses, doctor shares, receivables and profit and loss.",
  },
  {
    slug: "billing-and-payments",
    name: "Billing and Payments",
    short: "Invoices, receipts, deposits, discounts and any printer you own.",
  },
];

export const featurePath = (slug: FeatureSlug) => `/features/${slug}`;

export const MAIN_NAV = [
  { href: "/features", label: "Features" },
  { href: "/features/ai-scribe", label: "AI Scribe" },
  { href: "/features/whatsapp-integration", label: "WhatsApp" },
  { href: "/about", label: "About" },
];

export const DEMO_PATH = "/contact#demo";
/** The app's single sign-in page, for every role (clinic staff and the FlexicaAI team). */
export const LOGIN_PATH = "/login";
