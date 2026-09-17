import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, Mail } from "lucide-react";
import { Logo } from "@/core/ui/logo";
import { ThemeSwitch } from "./theme-switch";
import { Magnetic } from "./magnetic";
import { FooterNavLinks, HeaderNavLinks, type NavItem } from "./nav-links";
import { FacebookIcon, InstagramIcon, LinkedInIcon } from "./social-icons";
import { MobileNav } from "./mobile-nav";
import { OffscreenMotion } from "./offscreen-motion";
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
 * The public site's chrome — header + footer — as a component rather than a layout.
 *
 * It is a COMPONENT because the 404 needs it too. `not-found.tsx` has to live at the
 * app root to catch unmatched URLs, which puts it outside this route group, so a
 * layout could never reach it and the 404 rendered as a bare dead end with no way
 * back into the site.
 *
 * Contains NO request data (no cookies/headers/session), which is what keeps these
 * pages statically generated; see the note in the root layout. That constraint is
 * doubly important now: `not-found.tsx` is composed into the ROOT segment, so a
 * dynamic API reached from here would mark EVERY route in the app dynamic.
 *
 * Nothing here may reach for the signed-in app's chrome: a visitor has no session, no
 * clinic and no enabled modules, so the copy stays specialty-agnostic throughout.
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
 * Real pages only. Security still has its section on the homepage and a link in the
 * footer; it is not a peer of the three capability pages.
 */
const NAV: readonly NavItem[] = [
  { href: "/ai-medical-scribe", label: "AI scribe" },
  { href: "/whatsapp-for-patients", label: "WhatsApp" },
  { href: "/billing-and-revenue", label: "Billing" },
  { href: "/contact", label: "Contact" },
];

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    // `marketing-root` is the hook the scoped smooth-scroll rule AND the marketing
    // palette key off — see globals.css. It must not appear in the signed-in app.
    <div className="marketing-root flex min-h-screen flex-col bg-background text-foreground">
      {/* Film grain over the whole page. Fixed + pointer-events-none so it never
          intercepts a click and never scrolls out of alignment. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[60] bg-grain opacity-[0.03] mix-blend-overlay dark:opacity-[0.05]"
      />

      {/* A floating pill rather than a full-width bar. It starts transparent over the
          hero and frosts as the page scrolls (`mk-header`, scroll-driven, no script).
          The <header> itself stays the positioned ancestor the mobile menu panel
          anchors to. */}
      <header className="sticky top-0 z-50 px-3 pt-3 sm:px-4">
        <div className="mk-header mx-auto flex h-14 backdrop-blur-xl backdrop-saturate-150 w-full max-w-6xl items-center gap-3 rounded-full pr-2 pl-5 sm:gap-6">
          <Link href="/" aria-label="FlexicaAI home" className="shrink-0 transition-opacity hover:opacity-80">
            <Logo variant="mark" className="h-6 sm:h-7" />
          </Link>

          {/* Named, because the footer carries two <nav>s of its own and an unlabelled
              landmark is useless when a screen reader lists three. */}
          <nav aria-label="Main" className="hidden flex-1 items-center justify-center gap-1 md:flex">
            <HeaderNavLinks items={NAV} />
          </nav>

          <div className="ml-auto flex items-center gap-1 sm:gap-2 md:ml-0">
            <MobileNav items={NAV} />
            <div className="hidden md:flex">
              <ThemeSwitch />
            </div>
            {/* Below sm the header can only fit one of these, and the CTA is the one
                worth keeping — signing in is also in the hero and the footer. */}
            <Link
              href="/login"
              className="hidden h-9 items-center rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
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

      <OffscreenMotion />

      <main className="flex-1">{children}</main>

      <footer className="relative isolate overflow-hidden border-t border-[var(--mk-line)]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-40 left-1/2 -z-10 h-80 w-[60rem] -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,var(--brand-teal)_0%,transparent_65%)] opacity-[0.08] blur-3xl dark:opacity-[0.14]"
        />
        <div className="mx-auto w-full max-w-6xl px-4 pt-16 pb-10 sm:px-6">
          {/* min-w-0 on both columns: at the md breakpoint this becomes a flex row, and
              flex items default to min-width:auto, so the email address — one long
              token with no break opportunity — stopped its column shrinking and pushed
              the whole document wider than the viewport at exactly 768px. */}
          <div className="flex flex-col gap-12 md:flex-row md:justify-between">
            <div className="min-w-0 max-w-sm space-y-5">
              <Logo variant="mark" className="h-8" />
              <p className="text-[0.95rem] leading-relaxed text-muted-foreground">
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
                            "inline-flex size-10 items-center justify-center rounded-full bg-card text-muted-foreground ring-1 ring-foreground/10 transition-all duration-300 hover:-translate-y-0.5",
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

            {/* Each column is a <nav> named by its own visible label rather than an
                <h2>: they are the names of two link groups, not document sections. */}
            <div className="grid min-w-0 gap-10 sm:grid-cols-2 sm:gap-16">
              <nav aria-labelledby="footer-product" className="space-y-4">
                <p
                  id="footer-product"
                  className="text-xs font-semibold tracking-[0.14em] text-foreground uppercase"
                >
                  Product
                </p>
                <ul className="space-y-2 text-[0.95rem] text-muted-foreground">
                  <FooterNavLinks items={NAV} />
                  <li>
                    <Link href="/#security" className="mk-link inline-flex items-center py-1 transition-colors hover:text-foreground">
                      Security
                    </Link>
                  </li>
                  <li>
                    <Link href="/login" className="mk-link inline-flex items-center py-1 transition-colors hover:text-foreground">
                      Sign in
                    </Link>
                  </li>
                </ul>
              </nav>

              <nav aria-labelledby="footer-contact" className="space-y-4">
                <p
                  id="footer-contact"
                  className="text-xs font-semibold tracking-[0.14em] text-foreground uppercase"
                >
                  Talk to us
                </p>
                <ul className="space-y-2 text-[0.95rem] text-muted-foreground">
                  <li>
                    <a
                      href={SALES_WHATSAPP_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group inline-flex items-center gap-2 py-1 transition-colors hover:text-whatsapp-fg"
                    >
                      <WhatsAppIcon className="size-4" />
                      WhatsApp {SALES_PHONE_DISPLAY}
                      <ArrowUpRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                    </a>
                  </li>
                  <li>
                    <a
                      href={SALES_EMAIL_URL}
                      className="inline-flex min-w-0 items-start gap-2 py-1 transition-colors hover:text-foreground"
                    >
                      <Mail className="mt-1 size-4 shrink-0" aria-hidden="true" />
                      <span className="mk-link break-all">{SALES_EMAIL}</span>
                    </a>
                  </li>
                </ul>
              </nav>
            </div>
          </div>

          {/* The wordmark set large and cropped by the footer's edge — a signature
              rather than another logo. Decorative; the real name is in the logo above. */}
          <p
            aria-hidden="true"
            className="pointer-events-none mt-16 -mb-4 bg-gradient-to-b from-foreground/[0.09] to-transparent bg-clip-text text-center text-[clamp(4rem,17vw,13rem)] leading-[0.8] font-bold tracking-[-0.06em] text-transparent select-none"
          >
            FlexicaAI
          </p>

          <div className="flex flex-col gap-3 border-t border-[var(--mk-line)] pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} FlexicaAI. All rights reserved.</p>
            {/* Policy links in the bottom bar rather than a fourth column: they are the
                links people go looking for deliberately. */}
            <div className="flex items-center gap-4">
              {/* py-1.5, not py-1: at 12px these came out a hair under the 24px
                  minimum target once subpixel rounding is applied. */}
              <Link href="/privacy" className="mk-link inline-flex items-center py-1.5 transition-colors hover:text-foreground">
                Privacy
              </Link>
              <Link href="/terms" className="mk-link inline-flex items-center py-1.5 transition-colors hover:text-foreground">
                Terms
              </Link>
              <span>{SITE_DOMAIN}</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
