"use client";

import type { FeatureSlug } from "../../lib/nav";
import { ScribeStory } from "./scribe-story";
import { WhatsappStory } from "./whatsapp-story";

/** The scroll-driven 3D story for feature pages that have one. */
export function FeatureStory({ slug }: { slug: FeatureSlug }) {
  if (slug === "ai-scribe") return <ScribeStory />;
  if (slug === "whatsapp-integration") return <WhatsappStory />;
  return null;
}
