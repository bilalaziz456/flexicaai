import type { MetadataRoute } from "next";
import { BRAND_WEBSITE } from "@/core/lib/brand";

/**
 * The sitemap. Exactly one entry today, because the public site is one page — the
 * rest of the app is behind sign-in and is disallowed in robots.ts.
 *
 * Deliberately not listing anchors like /#features: they are not separate documents
 * and listing them tells a crawler nothing it does not already get from the page.
 * Add real entries here when the site grows a second page.
 */
const origin = `https://${BRAND_WEBSITE.replace(/^https?:\/\//, "")}`;

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: origin,
      // Build time, not request time — this file is prerendered, and `new Date()`
      // here would otherwise freeze at whenever the build ran anyway.
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
