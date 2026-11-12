import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/site/components/site/site-shell";
import { ButtonLink, Container } from "@/site/components/ui";
import { FEATURE_LINKS, featurePath } from "@/site/lib/nav";

/**
 * App-wide 404. Rendered for unmatched URLs and any `notFound()` call that has no
 * closer boundary. It carries the public site's header and footer (SiteShell), because
 * `not-found.tsx` has to sit at the app root — outside the `(marketing)` group.
 *
 * Two things this file must NOT do:
 *  - reach for a dynamic API (cookies/headers/session). It is composed into the ROOT
 *    segment, so anything dynamic here marks EVERY route in the app dynamic.
 *  - assume a session. Someone hitting a bad URL may well be signed in, but this page
 *    cannot know that without going dynamic, so the chrome stays the public one.
 *
 * The title comes from the `metadata` export (verified to emit exactly one <title>).
 */
export const metadata: Metadata = {
  title: "Page not found | FlexicaAI",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <SiteShell mainClassName="band-dark grain relative overflow-hidden outline-none">
      <div
        className="pointer-events-none absolute inset-0 grid-dots-dark [mask-image:radial-gradient(ellipse_60%_60%_at_50%_40%,black,transparent)]"
        aria-hidden
      />
      <Container className="relative flex min-h-[80svh] flex-col items-center justify-center py-32 text-center">
        <p className="font-mono text-[clamp(5rem,16vw,10rem)] font-semibold leading-none tracking-tighter text-transparent [-webkit-text-stroke:1px_rgb(95_224_228/0.45)]" aria-hidden>
          404
        </p>
        <h1 className="text-h1 mt-6 max-w-2xl text-white">This page isn&apos;t in the diary.</h1>
        <p className="text-lead mt-5 max-w-xl text-slate-300">
          The link may be old, or the page may have moved. Here are the places most people are looking for.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/" arrow>
            Back to home
          </ButtonLink>
          <ButtonLink href="/features" tone="ghost-dark">
            Explore features
          </ButtonLink>
          <ButtonLink href="/contact" tone="ghost-dark">
            Contact us
          </ButtonLink>
        </div>
        <ul className="mt-12 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[0.92rem]">
          {FEATURE_LINKS.map((f) => (
            <li key={f.slug}>
              <Link href={featurePath(f.slug)} className="text-slate-400 underline-offset-4 hover:text-white hover:underline">
                {f.name}
              </Link>
            </li>
          ))}
        </ul>
      </Container>
    </SiteShell>
  );
}
