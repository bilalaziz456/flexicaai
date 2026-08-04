import type { ReactNode } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
import { Logo } from "@/core/ui/logo";
import { ThemeSwitch } from "./theme-switch";
import { Cursor, Magnetic } from "./cursor";
import { WhatsAppCta } from "./whatsapp-cta";
import { WhatsAppIcon } from "./whatsapp-icon";
import {
  SALES_EMAIL,
  SALES_EMAIL_URL,
  SALES_PHONE_DISPLAY,
  SALES_WHATSAPP_URL,
  SITE_DOMAIN,
} from "./contact";

/**
 * Public marketing shell — header + footer around every public page.
 *
 * Contains NO request data (no cookies/headers/session), which is what keeps these
 * pages statically generated; see the note in the root layout. Nothing here may
 * reach for the signed-in app's chrome: a visitor has no session, no clinic and no
 * enabled modules, so the copy stays specialty-agnostic throughout.
 */

const NAV = [
  { href: "#features", label: "Features" },
  { href: "#how", label: "How it works" },
  { href: "#specialties", label: "Specialties" },
  { href: "#security", label: "Security" },
];

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    // `marketing-root` is the hook the scoped smooth-scroll rule keys off — see
    // globals.css. It must not appear anywhere in the signed-in app.
    <div className="marketing-root flex min-h-screen flex-col bg-background">
      {/* Renders nothing on touch or under reduced motion — see the component. */}
      <Cursor />


      {/* Film grain over the whole page. Fixed + pointer-events-none so it never
          intercepts a click and never scrolls out of alignment. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[60] bg-grain opacity-[0.035] mix-blend-overlay dark:opacity-[0.05]"
      />
      <header className="sticky top-0 z-50 border-b border-foreground/5 bg-background/80 backdrop-blur-lg">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/" aria-label="FlexicaAI home" className="shrink-0">
            <Logo variant="mark" className="h-7" />
          </Link>

          <nav className="hidden flex-1 items-center gap-7 md:flex">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <ThemeSwitch />
            {/* Below sm the header can only fit one of these, and the CTA is the one
                worth keeping — signing in is also in the hero and the footer. */}
            <Link
              href="/login"
              className="hidden rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
            >
              Sign in
            </Link>
            <Magnetic strength={0.25}>
              <WhatsAppCta size="sm">
                <span className="sm:hidden">Demo</span>
                <span className="hidden sm:inline">Book a demo</span>
              </WhatsAppCta>
            </Magnetic>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-foreground/10 bg-muted/40">
        <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
          <div className="flex flex-col gap-10 md:flex-row md:justify-between">
            <div className="max-w-sm space-y-4">
              <Logo variant="mark" className="h-8" />
              <p className="text-sm text-muted-foreground">
                AI-powered health management. We handle the record keeping, the
                messaging and the money side of running a practice.
              </p>
            </div>

            <div className="grid gap-8 sm:grid-cols-2">
              <div className="space-y-3">
                <h2 className="text-xs font-semibold tracking-widest text-foreground uppercase">
                  Product
                </h2>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {NAV.map((item) => (
                    <li key={item.href}>
                      <a href={item.href} className="transition-colors hover:text-foreground">
                        {item.label}
                      </a>
                    </li>
                  ))}
                  <li>
                    <Link href="/login" className="transition-colors hover:text-foreground">
                      Sign in
                    </Link>
                  </li>
                </ul>
              </div>

              <div className="space-y-3">
                <h2 className="text-xs font-semibold tracking-widest text-foreground uppercase">
                  Talk to us
                </h2>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>
                    <a
                      href={SALES_WHATSAPP_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 transition-colors hover:text-[#25d366]"
                    >
                      <WhatsAppIcon className="size-4" />
                      WhatsApp {SALES_PHONE_DISPLAY}
                    </a>
                  </li>
                  <li>
                    <a
                      href={SALES_EMAIL_URL}
                      className="inline-flex items-center gap-2 transition-colors hover:text-foreground"
                    >
                      <Mail className="size-4" aria-hidden="true" />
                      {SALES_EMAIL}
                    </a>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-10 flex flex-col gap-2 border-t border-foreground/10 pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} FlexicaAI. All rights reserved.</p>
            <p>{SITE_DOMAIN}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
