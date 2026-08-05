import type { ReactNode } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
import { Logo } from "@/core/ui/logo";
import { ThemeSwitch } from "./theme-switch";
import { Magnetic } from "./magnetic";
import { FooterNavLinks, HeaderNavLinks, type NavItem } from "./nav-links";
import { FacebookIcon, InstagramIcon, LinkedInIcon } from "./social-icons";
import { cn } from "@/core/lib/utils";
import { WhatsAppCta } from "./whatsapp-cta";
import { WhatsAppIcon } from "./whatsapp-icon";
import {
  SALES_EMAIL,
  SALES_EMAIL_URL,
  SALES_PHONE_DISPLAY,
  SALES_WHATSAPP_URL,
  SOCIAL_LINKS,
  SITE_DOMAIN,
} from "./contact-details";

/**
 * Public marketing shell — header + footer around every public page.
 *
 * Contains NO request data (no cookies/headers/session), which is what keeps these
 * pages statically generated; see the note in the root layout. Nothing here may
 * reach for the signed-in app's chrome: a visitor has no session, no clinic and no
 * enabled modules, so the copy stays specialty-agnostic throughout.
 */

const SOCIAL_ICONS = {
  facebook: FacebookIcon,
  instagram: InstagramIcon,
  linkedin: LinkedInIcon,
} as const;

/** Each platform's own colour on hover, so the row is not a wall of grey. */
const SOCIAL_HOVER = {
  facebook: "hover:bg-facebook/10 hover:text-facebook hover:ring-facebook/40",
  instagram: "hover:bg-instagram/10 hover:text-instagram hover:ring-instagram/40",
  linkedin: "hover:bg-linkedin/10 hover:text-linkedin hover:ring-linkedin/40",
} as const;

/**
 * Real pages only. This used to carry "/#security", left over from when the whole nav
 * was homepage anchors — one item jumping back to a section while its neighbours were
 * pages, which read as inconsistent and put a trust topic on a level with the three
 * capability pages. Security still has its section on the homepage and a link in the
 * footer; it is not a peer of these.
 */
const NAV: readonly NavItem[] = [
  { href: "/ai-medical-scribe", label: "AI scribe" },
  { href: "/whatsapp-for-patients", label: "WhatsApp" },
  { href: "/billing-and-revenue", label: "Billing" },
  { href: "/contact", label: "Contact" },
];

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    // `marketing-root` is the hook the scoped smooth-scroll rule keys off — see
    // globals.css. It must not appear anywhere in the signed-in app.
    <div className="marketing-root flex min-h-screen flex-col bg-background">


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
            <HeaderNavLinks items={NAV} />
          </nav>

          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <ThemeSwitch />
            {/* Below sm the header can only fit one of these, and the CTA is the one
                worth keeping — signing in is also in the hero and the footer. */}
            <Link
              href="/login"
              // px-4 py-2 puts this at 36px, matching every other header control; at
              // px-3 py-1.5 it sat 4px shorter than the CTA right beside it.
              className="hidden rounded-full px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
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

              {/* Only the profiles that actually have a URL. If none are configured
                  the whole row disappears rather than leaving dead icons. */}
              {SOCIAL_LINKS.some((s) => s.url) ? (
                <ul className="flex items-center gap-2">
                  {SOCIAL_LINKS.filter((s) => s.url).map((social) => {
                    const Icon = SOCIAL_ICONS[social.id];
                    return (
                      <li key={social.id}>
                        <a
                          href={social.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`FlexicaAI on ${social.label}`}
                          className={cn(
                            "inline-flex size-9 items-center justify-center rounded-full text-muted-foreground ring-1 ring-foreground/10 transition-all hover:-translate-y-0.5",
                            SOCIAL_HOVER[social.id],
                          )}
                        >
                          <Icon className="size-4" />
                        </a>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>

            <div className="grid gap-8 sm:grid-cols-2">
              <div className="space-y-3">
                <h2 className="text-xs font-semibold tracking-widest text-foreground uppercase">
                  Product
                </h2>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <FooterNavLinks items={NAV} />
                  <li>
                    <Link
                      href="/#security"
                      className="inline-flex items-center py-1 transition-colors hover:text-foreground"
                    >
                      Security
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/login"
                      className="inline-flex items-center py-1 transition-colors hover:text-foreground"
                    >
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
                      className="inline-flex items-center gap-2 py-1 transition-colors hover:text-whatsapp"
                    >
                      <WhatsAppIcon className="size-4" />
                      WhatsApp {SALES_PHONE_DISPLAY}
                    </a>
                  </li>
                  <li>
                    <a
                      href={SALES_EMAIL_URL}
                      className="inline-flex items-center gap-2 py-1 transition-colors hover:text-foreground"
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
