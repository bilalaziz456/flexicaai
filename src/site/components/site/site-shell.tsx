import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { Footer } from "./footer";
import { Header } from "./header";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });

/**
 * The public website's wrapper: its fonts, a skip link, header, main and footer.
 *
 * Everything the site looks like hangs off `.flx-site`: the fonts, and every page-wide
 * rule in src/site/site.css. That keeps the site's styling out of the dashboards even
 * though Next keeps a route's CSS loaded after a client-side navigation.
 *
 * A plain component (not only the layout) because the app's 404 sits outside the
 * (marketing) route group and needs the same chrome. Static: nothing request-dependent.
 */
export function SiteShell({ children, mainClassName = "outline-none" }: { children: ReactNode; mainClassName?: string }) {
  return (
    <div className={`${geist.variable} ${geistMono.variable} flx-site min-h-screen antialiased`}>
      <a
        href="#main"
        className="fixed left-4 top-3 z-[60] -translate-y-24 rounded-full bg-teal px-5 py-2.5 text-sm font-semibold text-navy-900 transition-transform focus-visible:translate-y-0"
      >
        Skip to content
      </a>
      <Header />
      <main id="main" tabIndex={-1} className={mainClassName}>
        {children}
      </main>
      <Footer />
    </div>
  );
}
