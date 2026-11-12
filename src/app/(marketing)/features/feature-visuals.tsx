import type { FeatureSlug } from "@/site/lib/nav";
import { AppointmentDetail } from "@/site/components/mockups/appointment-detail";
import { BillingDetail } from "@/site/components/mockups/billing-detail";
import { BillingHero } from "@/site/components/pages3d/billing-hero";
import { AnalyticsHero } from "@/site/components/pages3d/analytics-hero";
import { ExpenseBreakdown, PnlWaterfall, RevenueChart } from "@/site/components/mockups/finance";
import { InboxWindow } from "@/site/components/mockups/inbox";
import { NoteCard, TranscriptCard } from "@/site/components/mockups/scribe";
import { ShowcaseVisual } from "@/site/components/mockups/showcase";
import { AppointmentHero } from "@/site/components/pages3d/appointment-hero";
import { PatientHero } from "@/site/components/pages3d/patient-hero";
import { ScribeHero } from "@/site/components/pages3d/scribe-hero";
import { WhatsAppHero } from "@/site/components/pages3d/whatsapp-hero";

/** Is the hero visual for this feature drawn for a dark band? */
export const DARK_VISUAL: Record<FeatureSlug, boolean> = {
  "patient-management": false,
  "appointment-management": false,
  "ai-scribe": true,
  "whatsapp-integration": false,
  "clinic-analytics": true,
  "billing-and-payments": false,
};

/** The main product visual shown on each feature page. */
export function FeatureHeroVisual({ slug }: { slug: FeatureSlug }) {
  switch (slug) {
    case "patient-management":
      return <PatientHero />;
    case "appointment-management":
      return <AppointmentHero />;
    case "ai-scribe":
      return <ScribeHero />;
    case "whatsapp-integration":
      return <WhatsAppHero />;
    case "clinic-analytics":
      return <AnalyticsHero />;
    case "billing-and-payments":
      return <BillingHero />;
  }
}

/** A second, deeper visual block shown mid-page. */
export function FeatureDetailVisual({ slug }: { slug: FeatureSlug }) {
  switch (slug) {
    case "patient-management":
      return (
        <div className="grid items-start gap-6 md:grid-cols-2">
          <ShowcaseVisual k="medical-history" />
          <ShowcaseVisual k="treatment-plans" />
        </div>
      );
    case "appointment-management":
      return <AppointmentDetail />;
    case "ai-scribe":
      return (
        <div className="grid items-start gap-6 lg:grid-cols-[0.85fr_1.15fr]">
          <TranscriptCard />
          <NoteCard />
        </div>
      );
    case "whatsapp-integration":
      return <InboxWindow />;
    case "clinic-analytics":
      return (
        <div className="grid gap-6">
          <RevenueChart />
          <div className="grid items-start gap-6 lg:grid-cols-[1.3fr_1fr]">
            <PnlWaterfall />
            <ExpenseBreakdown />
          </div>
        </div>
      );
    case "billing-and-payments":
      return <BillingDetail />;
  }
}

/** Whether the detail visual needs a dark band. */
export const DARK_DETAIL: Record<FeatureSlug, boolean> = {
  "patient-management": false,
  "appointment-management": true,
  "ai-scribe": true,
  "whatsapp-integration": false,
  "clinic-analytics": true,
  "billing-and-payments": true,
};
