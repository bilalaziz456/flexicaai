import type { Metadata } from "next";
import {
  BarChart3,
  Banknote,
  FileCheck2,
  Percent,
  PiggyBank,
  Printer,
  Receipt,
  Stethoscope,
  Undo2,
  Users,
  Wallet,
} from "lucide-react";
import { ClosingBand, SectionHeading } from "../sections";
import { CapabilityHero, CapabilityList, Pipeline, Showcase, type PipelineStep } from "../ai-kit";
import { FinanceDashboard } from "../finance-dashboard";
import { FinanceHeroArt } from "../finance-hero-art";
import { CountUp } from "../count-up";
import { pageJsonLd } from "../structured-data";

/**
 * The money page.
 *
 * The argument: most practices know what they invoiced and not what they collected,
 * because those two numbers live in different places. Everything here derives from
 * visits the team already records, which is why the figures reconcile at all.
 *
 * Story: the glance (hero) → the dashboard an owner opens (showcase) → how one visit becomes every figure
 * (pipeline) → the three numbers that always agree (reconciliation) → the guarantees at
 * the desk and at month end → the ask.
 *
 * Careful not to overclaim twice over: this is bookkeeping for a practice, not
 * accounting software; and billing has no AI, so nothing here says it does — the
 * dashboard's flags are the ledger's own arithmetic.
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

const FLOW: PipelineStep[] = [
  {
    Icon: Stethoscope,
    title: "Visit completed",
    body: "The provider finishes the visit. That event, not a separate data-entry step, is where the money starts.",
  },
  {
    Icon: Receipt,
    title: "Bill raised",
    body: "Priced services become a numbered invoice. A discount waits for approval and counts as zero until it gets it.",
  },
  {
    Icon: Users,
    title: "Shares credited",
    body: "The moment the visit is completed, each provider’s share is credited to their balance, so payouts are never reconstructed later.",
  },
  {
    Icon: Banknote,
    title: "Payment taken",
    body: "All of it, part of it, or from credit held — each with its own receipt number. What is still owed is worked out, not typed.",
  },
  {
    Icon: BarChart3,
    title: "Reports agree",
    body: "Revenue, receivables and profit read the same records, so the month-end figures reconcile without a spreadsheet.",
  },
];

const AT_THE_DESK = [
  {
    Icon: Receipt,
    title: "Priced services, per practice",
    body: "Your own list of services and prices. Editing the list never rewrites a past bill — each line keeps the price it was charged at.",
  },
  {
    Icon: Percent,
    title: "Discounts that need a signature",
    body: "A discount can require approval before it counts. Until then, the bill and the revenue figure both behave as if it were zero.",
  },
  {
    Icon: FileCheck2,
    title: "Numbered invoices and receipts",
    body: "Sequential per practice, reset each year, in separate series. The number a patient quotes on the phone finds the visit.",
  },
  {
    Icon: Printer,
    title: "Prints the way you already print",
    body: "Thermal, A5 or A4, with your logo on it. Nobody changes the printer on the front desk to start using this.",
  },
];

const AT_MONTH_END = [
  {
    Icon: Wallet,
    title: "Collected, not invoiced",
    body: "The headline figure is money actually taken, because that is the number that pays salaries.",
  },
  {
    Icon: Users,
    title: "Per provider",
    body: "What each provider earned, has been paid and is still owed, as a running balance with a printable statement.",
  },
  {
    Icon: PiggyBank,
    title: "Against what it cost",
    body: "Expenses sit beside income, including recurring ones that post themselves, so profit is not a separate exercise.",
  },
  {
    Icon: Undo2,
    title: "Reversible, not deletable",
    body: "A wrong payment is voided, not erased. The correction stays visible, which is what makes the ledger trustworthy.",
  },
];

/** Billed − collected = outstanding, set as type: the reconciliation the page promises. */
function Reconciliation() {
  const term = "flex flex-col items-center gap-2 text-center";
  const figure = "text-[clamp(1.9rem,4.4vw,3.6rem)] leading-none font-bold tracking-[-0.045em]";
  const op = "text-[clamp(1.5rem,3vw,2.5rem)] font-light text-muted-foreground";
  return (
    <div className="reveal-up mk-card overflow-hidden rounded-[2rem] px-6 py-12 sm:px-10 sm:py-16">
      <div className="flex flex-col items-center justify-center gap-6 lg:flex-row lg:gap-10">
        <div className={term}>
          <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Billed</span>
          <span className={figure}>
            <CountUp value={1605000} prefix="Rs " />
          </span>
        </div>
        <span aria-hidden="true" className={op}>
          −
        </span>
        <div className={term}>
          <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Collected</span>
          <span className={`${figure} mk-gradient-text`}>
            <CountUp value={1428500} prefix="Rs " delay={200} />
          </span>
        </div>
        <span aria-hidden="true" className={op}>
          =
        </span>
        <div className={term}>
          <span className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Still to collect</span>
          <span className={`${figure} text-warning-text`}>
            <CountUp value={176500} prefix="Rs " delay={400} />
          </span>
        </div>
      </div>
      <p className="mx-auto mt-10 max-w-2xl text-center text-[1.02rem] leading-relaxed text-muted-foreground">
        Three numbers from the same visits, so they can never disagree. Nobody typed the
        outstanding figure in — it is what remains when payments are set against bills.
      </p>
      <p className="mt-3 text-center text-2xs text-muted-foreground/80">Sample practice figures.</p>
    </div>
  );
}

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

      <CapabilityHero
        accent="blue"
        eyebrow="Billing and revenue"
        lines={["Know what", "you actually", "collected."]}
        lede="Bills, receipts, part payments, provider shares and dues in one place — and a clear view of the money built from the visits your team already records."
        secondary={{ href: "#the-whole-picture", label: "See the dashboard" }}
        art={<FinanceHeroArt />}
      />

      <Showcase
        id="the-whole-picture"
        accent="blue"
        eyebrow="The whole picture"
        title="Every figure an owner asks about, on one screen"
        lede="What came in, what was billed, what is still owed and what providers are owed — then the trend, and what needs attention. Hover the chart."
      >
        <FinanceDashboard />
      </Showcase>

      <section id="how-money-flows" className="scroll-mt-24 py-24 sm:py-32">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="One visit, every figure"
            title="The money follows the visit"
            lede="Nothing on the dashboard is entered twice. Each figure is a consequence of something your team already did."
          />
          <div className="mt-16">
            <Pipeline steps={FLOW} accent="blue" />
          </div>
        </div>
      </section>

      <section className="border-y border-[var(--mk-line)] bg-muted/40 py-24 sm:py-32">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="At the end of the month"
            title="The figures reconcile because nothing was retyped"
            lede="Reports are derived from completed visits and the payments against them, not entered separately."
          />
          <div className="mt-14">
            <Reconciliation />
          </div>
        </div>
      </section>

      <section className="py-24 sm:py-32">
        <div className="mx-auto grid w-full max-w-6xl gap-14 px-4 sm:px-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-20">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <SectionHeading
              align="left"
              eyebrow="Built for a busy afternoon"
              title="Billing that holds up at the desk and at month end"
              lede="Every one of these exists because of something that goes wrong when a practice bills on paper or on trust."
            />
          </div>
          <div className="grid gap-x-10 gap-y-10 sm:grid-cols-2">
            <CapabilityList title="At the front desk" items={AT_THE_DESK} />
            <CapabilityList title="At month end" items={AT_MONTH_END} />
          </div>
        </div>
      </section>

      <ClosingBand
        title="Bring last month’s numbers"
        lede="Walk us through how you bill today and we will show you where the same figures would come from, including the ones that are currently hard to get at."
      />
    </>
  );
}
