import { ContactSection } from "@/site/components/contact/contact-section";
import { Hero } from "@/site/components/hero/hero";
import { FaqSection, PlatformSection, WhySection } from "@/site/components/home/sections";
import { SceneBooking } from "@/site/components/story/scene-booking";
import { SceneClinic } from "@/site/components/story/scene-clinic";
import { SceneFeatures } from "@/site/components/story/scene-features";
import { SceneFinance } from "@/site/components/story/scene-finance";
import { SceneInbox } from "@/site/components/story/scene-inbox";
import { SceneScribe } from "@/site/components/story/scene-scribe";
import { JsonLd } from "@/site/components/ui";
import {
  FAQ_JSON_LD,
  HOME_DESCRIPTION,
  HOME_TITLE,
  ORGANIZATION,
  SOFTWARE_APPLICATION,
  WEBSITE,
  pageMetadata,
} from "@/site/lib/site";

export const metadata = {
  ...pageMetadata({ title: HOME_TITLE, description: HOME_DESCRIPTION, path: "/" }),
  // The home title is already complete; skip the "%s | FlexicaAI" template.
  title: { absolute: HOME_TITLE },
};

const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [ORGANIZATION, WEBSITE, SOFTWARE_APPLICATION, FAQ_JSON_LD],
};

/**
 * The home page: the hero, then the clinic visit (arrival → consultation → the note),
 * WhatsApp booking, the AI scribe, the whole platform, patient communication, the money,
 * then platform architecture → why → FAQ → demo.
 */
export default function Home() {
  return (
    <>
      <JsonLd data={STRUCTURED_DATA} />
      <Hero />
      <SceneClinic />
      <SceneBooking />
      <SceneScribe />
      <SceneFeatures />
      <SceneInbox />
      <SceneFinance />
      <PlatformSection />
      <WhySection />
      <FaqSection />
      <ContactSection />
    </>
  );
}
