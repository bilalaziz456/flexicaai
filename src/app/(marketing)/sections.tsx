import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Magnetic } from "./magnetic";
import { WhatsAppCta } from "./whatsapp-cta";

/**
 * The marketing site's shared building blocks. Extracted from the landing page when
 * the feature pages arrived: four pages copying a card component is four places for
 * the hover, the spacing and the contrast fix to drift apart.
 *
 * Everything here is a server component. The client code on the public site is the
 * theme switch, the nav (for its active state), the hero parallax, Magnetic, the
 * product tour's active-step tracking and the count-up.
 *
 * The visual language (tokens, `mk-*` utilities) lives in globals.css under "Marketing
 * design system". Nothing here hard-codes a colour.
 */

/* ---------------------------------------------------------------- buttons ---- */

/**
 * The quiet partner to the WhatsApp CTA: a ringed pill with an arrow that steps
 * forward on hover. A `Link` for in-site routes and a plain `<a>` for anchors and
 * `mailto:`, since `Link` adds nothing to either.
 */
export function SecondaryButton({
  href,
  children,
  icon,
}: {
  href: string;
  children: ReactNode;
  /** Replaces the trailing arrow with a leading icon, e.g. for "Email us". */
  icon?: ReactNode;
}) {
  const className =
    "group inline-flex h-12 items-center gap-2 rounded-full bg-card/60 px-5 text-[0.95rem] font-medium text-foreground shadow-[0_0_0_1px_var(--mk-line-strong)] backdrop-blur transition-[background-color,box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:bg-card hover:shadow-[0_0_0_1px_var(--mk-line-strong),var(--mk-shadow)]";
  const content = (
    <>
      {icon}
      {children}
      {icon ? null : <ArrowRight className="mk-arrow size-4 text-muted-foreground" aria-hidden="true" />}
    </>
  );
  return href.startsWith("/") && !href.includes("#") ? (
    <Link href={href} className={className}>
      {content}
    </Link>
  ) : (
    <a href={href} className={className}>
      {content}
    </a>
  );
}

/* ------------------------------------------------------------------ cards ---- */

/**
 * The page's one card, used by every feature grid.
 *
 * Everything moving is on hover, not on a loop: motion that answers the pointer,
 * rather than grids of cards twitching in the corner of the eye.
 *
 * `as="li"` because an ordered list of steps needs real list items — the numbering
 * is meaning, not decoration.
 */
export function FeatureCard({
  Icon,
  title,
  body,
  eyebrow,
  pingDelay,
  as: Tag = "article",
}: {
  Icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
  /** Small label beside the icon, e.g. "STEP 2". */
  eyebrow?: string;
  /** Set to give the icon an expanding ring, offset by this much. */
  pingDelay?: string;
  as?: "article" | "li";
}) {
  return (
    <Tag className="group reveal-up mk-card mk-card-hover overflow-hidden p-7">
      {/* A soft brand light that rises into the corner on hover. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-20 -right-20 size-48 rounded-full bg-brand-teal/20 opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100"
      />

      <div className="relative flex items-center gap-3">
        <span className="relative inline-flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-teal/15 to-brand-blue/5 text-primary-text shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--brand-teal)_28%,transparent)] transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-105">
          <Icon className="size-5" />
          {pingDelay ? (
            <span
              aria-hidden="true"
              style={{ animationDelay: pingDelay }}
              className="absolute inset-0 rounded-2xl ring-2 ring-primary motion-safe:animate-ping-ring motion-reduce:hidden"
            />
          ) : null}
        </span>
        {eyebrow ? (
          <span className="font-mono text-xs tracking-widest text-muted-foreground">{eyebrow}</span>
        ) : null}
      </div>

      <h3 className="mk-h3 relative mt-6">{title}</h3>
      <p className="relative mt-2.5 text-[0.95rem] leading-relaxed text-muted-foreground">{body}</p>
    </Tag>
  );
}

/* -------------------------------------------------------------- headings ---- */

/** The kicker above a heading: a pill with a softly pulsing brand dot. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="mk-eyebrow">
      <span aria-hidden="true" className="relative inline-flex size-1.5">
        <span className="absolute inset-0 rounded-full bg-brand-teal motion-safe:animate-ping-ring" />
        <span className="relative size-1.5 rounded-full bg-brand-teal" />
      </span>
      {children}
    </p>
  );
}

/**
 * Editorial statement block: an oversized headline broken across deliberate lines,
 * the supporting paragraph beneath it, then a link onward.
 *
 * The line breaks are authored, not left to wrapping — that is the whole point of
 * the form, so `text-balance` is deliberately not used. On narrow screens each line
 * wraps within itself, which is fine because each is short.
 *
 * ---------------------------------------------------------------------------
 * WHICH HEADING COMPONENT TO USE
 *
 * Both render an <h2> by default, and the difference is EMPHASIS not rank:
 *
 *   Statement               — the ONE argument a section exists to make. Authored
 *                             line breaks; give it `as="h1"` when it opens a page.
 *   SectionHeading          — the ordinary label on a band of cards or a grid.
 *
 * Sub-headings inside either belong at <h3> — see FeatureCard.
 * ---------------------------------------------------------------------------
 */
export function Statement({
  eyebrow,
  lines,
  lede,
  cta,
  as: Tag = "h2",
}: {
  eyebrow: string;
  lines: string[];
  lede: string;
  cta?: { href: string; label: string };
  /** `h1` on a page's opening statement, `h2` for the rest. */
  as?: "h1" | "h2";
}) {
  // A page opener is a step larger than a mid-page statement, so the page's primary
  // heading always has visual primacy over any later <h2>.
  const size = Tag === "h1" ? "mk-display" : "mk-h2";
  return (
    <div className="reveal-up max-w-4xl">
      <Eyebrow>{eyebrow}</Eyebrow>

      <Tag className={`mt-6 ${size} [text-wrap:initial]`}>
        {lines.map((line, i) => (
          <span key={line} className="block">
            {/* The last line carries the brand gradient, so the eye lands on the end
                of the thought rather than the start. */}
            {i === lines.length - 1 ? <span className="mk-gradient-text">{line}</span> : line}
            {/* A trailing space on every line but the last. These lines are `block`,
                so without it the heading's TEXT runs together with no separator, and
                that is what a screen reader announces and a crawler indexes. */}
            {i < lines.length - 1 ? " " : null}
          </span>
        ))}
      </Tag>

      <p className="mt-6 max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground">
        {lede}
      </p>

      {cta ? (
        <a
          href={cta.href}
          className="group mt-8 inline-flex items-center gap-3 text-sm font-semibold text-foreground"
        >
          <span className="mk-link">{cta.label}</span>
          <span className="inline-flex size-8 items-center justify-center rounded-full shadow-[0_0_0_1px_var(--mk-line-strong)] transition-all duration-300 group-hover:bg-brand-teal group-hover:text-brand-navy group-hover:shadow-none">
            <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
          </span>
        </a>
      ) : null}
    </div>
  );
}

/**
 * Heading for sections that introduce a grid rather than sit beside art. Centred by
 * default; `align="left"` for a section whose content reads left to right, so the
 * page does not become one long column of centred blocks.
 */
export function SectionHeading({
  eyebrow,
  title,
  lede,
  align = "center",
}: {
  eyebrow: string;
  title: string;
  lede: string;
  align?: "center" | "left";
}) {
  return (
    <div className={`reveal-up max-w-3xl ${align === "center" ? "mx-auto text-center" : ""}`}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mk-h2 mt-6">{title}</h2>
      <p
        className={`mt-6 max-w-2xl text-lg leading-relaxed text-pretty text-muted-foreground ${align === "center" ? "mx-auto" : ""}`}
      >
        {lede}
      </p>
    </div>
  );
}

/* --------------------------------------------------------------- layouts ---- */

/**
 * The backdrop every page opens on: a faint circuit grid masked to the top, and the
 * brand light breathing behind it. One component so the homepage and the feature
 * pages cannot drift into two slightly different atmospheres.
 */
export function HeroBackdrop() {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]"
      >
        <div className="absolute -inset-x-20 -inset-y-20 bg-[linear-gradient(to_right,var(--color-foreground)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-foreground)_1px,transparent_1px)] bg-[size:56px_56px] opacity-[0.05] motion-safe:animate-grid-drift" />
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-48 left-[55%] -z-10 h-[40rem] w-[72rem] -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,var(--brand-teal)_0%,transparent_62%)] opacity-[0.16] blur-3xl motion-safe:animate-aurora dark:opacity-[0.22]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-40 -left-40 -z-10 h-[28rem] w-[40rem] bg-[radial-gradient(ellipse_at_center,var(--brand-blue)_0%,transparent_65%)] opacity-[0.08] blur-3xl dark:opacity-[0.16]"
      />
    </>
  );
}

/** The band every page ends on: a navy panel with the one call to action. */
export function ClosingBand({
  title,
  lede,
  secondary,
}: {
  title: string;
  lede: string;
  /** Optional quieter second action beside the WhatsApp CTA. */
  secondary?: ReactNode;
}) {
  return (
    <section data-motion-scope className="px-4 py-20 sm:px-6 sm:py-28">
      <div className="mk-inverse reveal-up ring-1 ring-white/10 relative isolate mx-auto w-full max-w-6xl overflow-hidden rounded-[2rem] px-6 py-16 text-center shadow-[var(--mk-shadow-lift)] sm:px-12 sm:py-24">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]"
        >
          <div className="absolute -inset-20 bg-[linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] bg-[size:48px_48px] opacity-[0.05] motion-safe:animate-grid-drift" />
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-1/2 left-1/2 -z-10 h-[36rem] w-[56rem] -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,var(--brand-teal)_0%,transparent_60%)] opacity-35 blur-3xl motion-safe:animate-aurora"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-teal/70 to-transparent"
        />

        <h2 className="mk-h2 mx-auto max-w-3xl">{title}</h2>
        <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground">
          {lede}
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Magnetic>
            <WhatsAppCta ping>Book a demo on WhatsApp</WhatsAppCta>
          </Magnetic>
          {secondary}
        </div>
      </div>
    </section>
  );
}
