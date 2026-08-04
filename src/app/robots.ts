import type { MetadataRoute } from "next";
import { BRAND_WEBSITE } from "@/core/lib/brand";

/**
 * Crawl rules. The marketing page is the only thing worth indexing — everything else
 * is the signed-in product.
 *
 * Those routes are already behind `requireRole()` and would only ever serve a
 * redirect to /login, so this is not a security measure. It is to stop a crawler
 * spending its budget on hundreds of redirects, and to keep sign-in and password
 * pages out of results where they help nobody.
 */
const origin = `https://${BRAND_WEBSITE.replace(/^https?:\/\//, "")}`;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/admin/",
          "/clinic/",
          "/doctor/",
          "/reception/",
          "/account",
          "/change-password",
          "/paused",
          "/login",
          "/forgot-password",
          "/reset-password",
          // Tokenised prescription links. Unguessable, but there is no reason for
          // one to end up in a search index.
          "/p/",
        ],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
