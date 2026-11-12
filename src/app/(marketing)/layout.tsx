import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { SiteShell } from "@/site/components/site/site-shell";
import { HOME_DESCRIPTION, HOME_TITLE, SITE_NAME } from "@/site/lib/site";

/**
 * Public marketing pages — the website redesign (sources in src/site/).
 *
 * Static on purpose, like the root layout: nothing request-dependent here, so every
 * public page stays prerendered (see src/proxy.ts on why that matters for the CSP).
 */
export const metadata: Metadata = {
  title: { default: HOME_TITLE, template: "%s | FlexicaAI" },
  description: HOME_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: { siteName: SITE_NAME, locale: "en_PK", type: "website" },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large" } },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#04152e",
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <SiteShell>{children}</SiteShell>;
}
