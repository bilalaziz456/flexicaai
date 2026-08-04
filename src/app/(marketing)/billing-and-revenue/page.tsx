import type { Metadata } from "next";
import {
  Banknote,
  FileCheck2,
  Percent,
  PiggyBank,
  Printer,
  Receipt,
  Undo2,
  Users,
  Wallet,
} from "lucide-react";
import { ClosingBand, FeatureCard, PageHero, SectionHeading, Statement } from "../sections";
import { BillingVisual } from "../billing-visual";
import { DerivationVisual } from "../derivation-visual";
import { pageJsonLd } from "../structured-data";

/**
 * The money page.
 *
 * The argument: most practices know what they invoiced and not what they collected,
 * because those two numbers live in different places. Everything here derives from
 * visits the team already records, which is why the figures reconcile at all.
 *
 * Careful not to overclaim — this is bookkeeping for a practice, not accounting
 * software, and the copy says so rather than implying it replaces an accountant.
 */

const TITLE = "Practice billing, payments and revenue reporting | FlexicaAI";
const DESCRIPTION =
  "Priced services, discounts that need approval, numbered invoices and receipts, part payments and dues. Revenue reports built from visits your team already records.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/billing-and-revenue" },
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", siteName: "FlexicaAI" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const BILLING = [
  {
    Icon: Receipt,
    title: "Priced services, per practice",
    body: "Your own list of procedures and prices. Editing the catalog never rewrites a past bill, because each line keeps the price it was charged at.",
  },
  {
    Icon: Percent,
    title: "Discounts that need a signature",
    body: "A discount can require approval before it counts. Until it is approved, the bill and the revenue figure both behave as if it were zero.",
  },
  {
    Icon: FileCheck2,
    title: "Numbered invoices and receipts",
    body: "Sequential per practice, reset each year, in separate series. The number a patient quotes on the phone finds the visit.",
  },
  {
    Icon: Banknote,
    title: "Part payments and advances",
    body: "Take some now and some later, or hold a credit against the patient. What is still owed is derived, never typed in by hand.",
  },
  {
    Icon: Undo2,
    title: "Reversible, not deletable",
    body: "A wrong payment is voided, not erased. The correction stays visible, which is what makes the ledger trustworthy at the end of the month.",
  },
  {
    Icon: Printer,
    title: "Prints the way you already print",
    body: "Thermal, A5 or A4, with your logo on it. Nobody has to change the printer on the front desk to start using this.",
  },
];

const REVENUE = [
  {
    Icon: Wallet,
    title: "Collected, not invoiced",
    body: "The headline figure is money actually taken, because that is the number that pays salaries. What was billed and what came in are shown apart.",
  },
  {
    Icon: Users,
    title: "Per provider",
    body: "What each provider earned, what they have been paid, and what is outstanding, as a running balance rather than a monthly reconstruction.",
  },
  {
    Icon: PiggyBank,
    title: "Against what it cost",
    body: "Operating expenses sit beside income, including recurring ones that post themselves, so the profit line is not a separate spreadsheet exercise.",
  },
];

export default function BillingAndRevenuePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            pageJsonLd({
              path: "/billing-and-revenue",
              name: "Billing and revenue",
              description: DESCRIPTION,
            }),
          ),
        }}
      />

      <PageHero
        eyebrow="Billing and revenue"
        lines={["Know what you", "collected,", "not what you billed."]}
        lede="Bills, receipts, part payments and dues in one place, and reports built from the same visits your team already records. No second spreadsheet to reconcile at month end."
        art={<BillingVisual className="reveal-up" />}
      />

      <section className="border-y border-foreground/10 bg-muted/40 py-12 sm:py-16">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="At the front desk"
            title="Billing that survives a busy afternoon"
            lede="Every one of these exists because of something that goes wrong when a practice bills on paper or on trust."
          />
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {BILLING.map((c) => (
              <FeatureCard key={c.title} {...c} />
            ))}
          </div>
        </div>
      </section>

      <section className="py-12 sm:py-16">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
          <div className="lg:order-2">
            <Statement
              eyebrow="At the end of the month"
              lines={["The figures", "reconcile because", "nothing was retyped."]}
              lede="Reports are derived from completed visits, not entered separately. That is the only reason the revenue number and the appointment book ever agree."
              cta={{ href: "/whatsapp-for-patients", label: "See patient messaging" }}
            />
          </div>
          <DerivationVisual className="reveal-up lg:order-1" />
        </div>

        <div className="mx-auto mt-12 grid w-full max-w-6xl gap-5 px-4 sm:px-6 md:grid-cols-3">
          {REVENUE.map((c) => (
            <FeatureCard key={c.title} {...c} />
          ))}
        </div>
      </section>

      <ClosingBand
        title="Bring last month's numbers"
        lede="Walk us through how you bill today and we will show you where the same figures would come from, including the ones that are currently hard to get at."
      />
    </>
  );
}
