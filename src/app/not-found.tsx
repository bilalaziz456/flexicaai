import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "./(marketing)/site-chrome";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";

/**
 * App-wide 404. Rendered for unmatched URLs and any `notFound()` call that has no
 * closer boundary.
 *
 * It carries the public site's header and footer. It previously rendered as a bare
 * centred block with one link and no chrome, so anyone who mistyped a URL or followed
 * a stale link landed somewhere with no navigation and no route onward except the
 * homepage. The shell is a plain component precisely so this file can use it —
 * `not-found.tsx` has to sit at the app root to catch unmatched URLs, which puts it
 * outside the `(marketing)` route group where a layout could reach it.
 *
 * Two things this file must NOT do:
 *  - reach for a dynamic API (cookies/headers/session). It is composed into the ROOT
 *    segment, so anything dynamic here marks EVERY route in the app dynamic. That has
 *    bitten this project before.
 *  - assume a session. Someone hitting a bad URL may well be signed in, but this page
 *    cannot know that without going dynamic, so the chrome stays the public one.
 *
 * The title comes from the `metadata` export below. Without it the tab read plain
 * "FlexicaAI", inherited from the root layout. Next's own docs only document a
 * metadata export on `global-not-found.js`, but it does work here — verified against
 * the served HTML, which carries exactly one <title>. Rendering an inline <title>
 * instead does NOT work: React hoists it, but the root layout's own title is emitted
 * too and wins, leaving two <title> tags in <head>.
 */
export const metadata: Metadata = { title: "Page not found | FlexicaAI" };

export default function NotFound() {
  return (
    <MarketingShell>
      <section className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 py-20 text-center sm:px-6 sm:py-28">
        <p className="font-mono text-sm tracking-widest text-primary-text uppercase">404</p>
        <h1 className="mt-4 font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          We cannot find that page
        </h1>
        <p className="mx-auto mt-4 max-w-md text-base text-muted-foreground">
          The link may be out of date, or the address may have a typo in it. The rest of
          the site is still where you left it.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link href="/" className={cn(buttonVariants(), "rounded-full px-5")}>
            Back to the homepage
          </Link>
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-medium ring-1 ring-foreground/15 transition-colors hover:bg-foreground/5"
          >
            Tell us what you were looking for
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}
