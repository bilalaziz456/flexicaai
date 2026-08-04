import type { MetadataRoute } from "next";
import { BRAND_WEBSITE } from "@/core/lib/brand";

/**
 * The sitemap: the homepage plus each feature page. Everything else is behind
 * sign-in and is disallowed in robots.ts.
 *
 * Deliberately not listing the homepage's anchors like /#features: they are not
 * separate documents and tell a crawler nothing the page itself does not.
 */
const origin = `https://${BRAND_WEBSITE.replace(/^https?:\/\//, "")}`;

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: origin, lastModified, changeFrequency: "monthly", priority: 1 },
    ...["/ai-medical-scribe", "/whatsapp-for-patients", "/billing-and-revenue", "/contact"].map(
      (path) => ({
        url: `${origin}${path}`,
        lastModified,
        changeFrequency: "monthly" as const,
        priority: 0.8,
      }),
    ),
  ];
}
