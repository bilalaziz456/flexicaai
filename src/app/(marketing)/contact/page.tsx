import { MapPin, MessagesSquare, Rocket, Settings2 } from "lucide-react";
import { ContactHero } from "@/site/components/contact/contact-hero";
import { PageMotion } from "@/site/components/pages3d/page-motion";
import { StillMap } from "@/site/components/pages3d/whatsapp-hero";
import { Band } from "@/site/components/site/page-blocks";
import { FeatureCards, StepTimeline } from "@/site/components/site/rich";
import { Eyebrow, JsonLd, SectionHeading } from "@/site/components/ui";
import { pageJsonLd, pageMetadata } from "@/site/lib/site";

const TITLE = "Book a Demo of Our Clinic Management Software";
const DESCRIPTION =
  "Book a personalised FlexicaAI demo for your clinic in Pakistan — on WhatsApp, by email or by phone.";

export const metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: "/contact" });

const CRUMBS = [
  { name: "Home", path: "/" },
  { name: "Contact", path: "/contact" },
];

// The same onboarding steps as the About page.
const STEPS = [
  { t: "A conversation", d: "Book a demo or message us on WhatsApp. We look at how your clinic runs today.", icon: MessagesSquare },
  { t: "Your setup", d: "Doctors and their hours, your services and prices, your team and what each person can access.", icon: Settings2 },
  { t: "Your first day", d: "Your team logs in to a clinic that already looks like theirs — with your letterhead and your MRN series.", icon: Rocket },
];

export default function ContactPage() {
  return (
    <>
      <JsonLd
        data={pageJsonLd({
          path: "/contact",
          name: "Contact FlexicaAI",
          description: DESCRIPTION,
          crumbs: CRUMBS,
          extra: [],
        })}
      />
      <ContactHero crumbs={CRUMBS} />

      <Band tone="white" labelledBy="next-title" ambient>
        <SectionHeading
          id="next-title"
          eyebrow="After you reach out"
          title="There is no sign-up form. We set your clinic up with you."
          lead="Every FlexicaAI account is provisioned by our team, around how your clinic already books, records and bills."
        />
        <StepTimeline steps={STEPS} />
      </Band>

      <Band tone="dark" labelledBy="where-title" ambient>
        <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:items-center">
          <div>
            <Eyebrow dark>Where we work</Eyebrow>
            <h2 id="where-title" className="text-h2 mt-5 text-white">
              Built for clinics across Pakistan.
            </h2>
            <p className="text-lead mt-5 flex items-start gap-3 text-slate-300">
              <MapPin className="mt-1.5 size-5 shrink-0 text-teal-glow" aria-hidden />
              Clinics in Karachi, Lahore, Islamabad and cities across Pakistan.
            </p>
          </div>
          <div className="relative" data-reveal>
            <div className="orb left-1/2 top-1/2 size-80 -translate-x-1/2 -translate-y-1/2 bg-teal/20" aria-hidden />
            <div className="relative">
              <StillMap />
            </div>
          </div>
        </div>
        <div className="mt-20">
          <p className="eyebrow text-teal-glow">Prefer to look around first?</p>
          <div className="mt-8">
            <FeatureCards dark />
          </div>
        </div>
      </Band>
      <PageMotion />
    </>
  );
}
