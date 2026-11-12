import type { MetadataRoute } from "next";
import { BRAND_WEBSITE } from "@/core/lib/brand";
import { FEATURE_LINKS, featurePath } from "@/site/lib/nav";

/**
 * The sitemap: every public website page, built from the same list the site's
 * navigation uses (src/site/lib/nav.ts), so it cannot list a page that is not built.
 * Everything else is behind sign-in and is disallowed in robots.ts.
 */
const origin = `https://${BRAND_WEBSITE.replace(/^https?:\/\//, "")}`;

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const page = (path: string, priority: number, changeFrequency: "monthly" | "yearly" = "monthly") => ({
    url: `${origin}${path === "/" ? "" : path}`,
    lastModified,
    changeFrequency,
    priority,
  });
  return [
    page("/", 1),
    page("/features", 0.9),
    ...FEATURE_LINKS.map((f) => page(featurePath(f.slug), 0.85)),
    page("/about", 0.6),
    page("/contact", 0.7),
    // Indexable and findable, at a low priority.
    page("/privacy", 0.3, "yearly"),
    page("/terms", 0.3, "yearly"),
  ];
}
