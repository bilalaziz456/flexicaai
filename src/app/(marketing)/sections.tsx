import type { ComponentType, ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Magnetic } from "./magnetic";
import { WhatsAppCta } from "./whatsapp-cta";

/**
 * The marketing site's shared building blocks. Extracted from the landing page when
 * the feature pages arrived: four pages copying a card component is four places for
 * the hover, the spacing and the contrast fix to drift apart.
 *
 * Everything here is a server component. The only client code on the public site is
 * the theme switch, the nav (for its active state), the hero parallax and Magnetic.
 */

/* ------------------------------------------------------------------ cards ---- */

/**
 * The page's one card, used by every feature grid and the three how-it-works steps.
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
    <Tag className="group reveal-up relative overflow-hidden rounded-2xl bg-card p-6 ring-1 ring-foreground/10 transition-all hover:-translate-y-1 hover:ring-primary/40">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-16 -right-16 size-32 rounded-full bg-primary/15 opacity-0 blur-2xl transition-opacity group-hover:opacity-100"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
      >
        <div className="h-full w-1/3 bg-[linear-gradient(90deg,transparent,var(--brand-teal),transparent)] opacity-10 blur-xl motion-safe:group-hover:animate-scan-x" />
      </div>

      <div className="relative flex items-center gap-3">
        <span className="relative inline-flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary-text ring-1 ring-primary/20 transition-all group-hover:scale-110 group-hover:bg-primary/20 group-hover:ring-primary/40">
          <Icon className="size-5" />
          {pingDelay ? (
            <span
              aria-hidden="true"
              style={{ animationDelay: pingDelay }}
              className="absolute inset-0 rounded-xl ring-2 ring-primary motion-safe:animate-ping-ring motion-reduce:hidden"
            />
          ) : null}
        </span>
        {eyebrow ? (
          <span className="font-mono text-xs tracking-widest text-muted-foreground">
            {eyebrow}
          </span>
        ) : null}
      </div>

      <h3 className="relative mt-5 font-heading text-lg font-medium transition-colors group-hover:text-primary-text">
        {title}
      </h3>
      <p className="relative mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </Tag>
  );
}

/* -------------------------------------------------------------- headings ---- */

/** The mono kicker with its blinking caret. Navy in light mode, not primary teal:
 *  teal at this size measured 2.54:1, under the 4.5:1 AA floor for small text. */
function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-xs tracking-widest text-brand-navy uppercase dark:text-brand-teal">
      {children}
      <span
        aria-hidden="true"
        className="ml-1 inline-block h-3 w-1.5 translate-y-px bg-brand-navy motion-safe:animate-pulse dark:bg-brand-teal"
      />
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
 * Left-aligned, unlike the centred SectionHeading. Alternating the two is what stops
 * a page reading as one long column of centred blocks.
 *
 * ---------------------------------------------------------------------------
 * WHICH HEADING COMPONENT TO USE
 *
 * Both render an <h2>, at deliberately different sizes, and the difference is
 * EMPHASIS not rank. An audit measured 64px and 36px <h2>s on the same page and
 * flagged it as drift, so the rule is written down here:
 *
 *   Statement (64px, left)   — the ONE argument a section exists to make. At most
 *                              two per page, never two in a row. Authored line
 *                              breaks; give it `as="h1"` when it opens a page.
 *   SectionHeading (36px)    — the ordinary label on a band of cards or a grid.
 *                              Everything that is not the page's main argument.
 *
 * If a page needs a third size, that is a sign the page has too many sections,
 * not that the scale needs another step. Sub-headings inside either belong at
 * <h3> (18px) — see FeatureCard.
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
  // A page opener is a step larger than a mid-page statement. Without this both
  // render from one clamp, so on the feature pages the <h1> and a later <h2> were
  // pixel-identical at 64px and the page's primary heading had no visual primacy.
  // The h1 step matches the homepage hero exactly, so every page now opens at the
  // same size — previously the homepage was 74px and the feature pages 64px.
  const size =
    Tag === "h1"
      ? "text-[clamp(2.6rem,7vw,4.6rem)] leading-[0.95]"
      : "text-[clamp(2.1rem,5.6vw,4rem)] leading-[0.98]";
  return (
    <div className="reveal-up max-w-4xl">
      <Eyebrow>{eyebrow}</Eyebrow>

      <Tag className={`mt-5 font-heading ${size} font-semibold tracking-[-0.035em]`}>
        {lines.map((line, i) => (
          <span key={line} className="block">
            {/* The last line carries the brand gradient, so the eye lands on the end
                of the thought rather than the start. */}
            {i === lines.length - 1 ? (
              <span className="bg-gradient-to-r from-brand-teal via-brand-blue to-brand-navy bg-clip-text text-transparent dark:to-brand-blue">
                {line}
              </span>
            ) : (
              line
            )}
            {/* A trailing space on every line but the last. These lines are `block`,
                so without it the heading's TEXT runs together with no separator, and
                that is what a screen reader announces and a crawler indexes. The
                space is invisible at the end of a block, so it costs nothing. */}
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
          className="group mt-7 inline-flex items-center gap-2 text-sm font-medium text-foreground"
        >
          {cta.label}
          <span className="inline-flex size-7 items-center justify-center rounded-full ring-1 ring-foreground/20 transition-all group-hover:bg-primary group-hover:text-primary-foreground group-hover:ring-primary">
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </a>
      ) : null}
    </div>
  );
}

/** Centred heading, for sections that introduce a grid rather than sit beside art. */
export function SectionHeading({
  eyebrow,
  title,
  lede,
}: {
  eyebrow: string;
  title: string;
  lede: string;
}) {
  return (
    <div className="reveal-up mx-auto max-w-2xl text-center">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-4 font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        {title}
      </h2>
      <p className="mt-5 text-lg text-pretty text-muted-foreground">{lede}</p>
    </div>
  );
}

/* --------------------------------------------------------------- layouts ---- */

/**
 * A feature page's opening: statement on one side, artwork on the other.
 *
 * The words stay FIRST in the DOM and are reordered visually only from `lg` up, so a
 * phone reads heading before illustration — which is also the order a screen reader
 * and a crawler get.
 */
export function PageHero({
  eyebrow,
  lines,
  lede,
  art,
  artFirst = false,
}: {
  eyebrow: string;
  lines: string[];
  lede: string;
  art: ReactNode;
  /** Put the artwork on the left from `lg` up. */
  artFirst?: boolean;
}) {
  return (
    <section data-motion-scope className="relative overflow-hidden">
      {/* Drifting circuit grid, masked out before it reaches the copy. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden [mask-image:radial-gradient(ellipse_at_top,black,transparent_72%)]"
      >
        <div className="absolute -inset-x-20 -inset-y-20 bg-[linear-gradient(to_right,var(--color-foreground)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-foreground)_1px,transparent_1px)] bg-[size:56px_56px] opacity-[0.04] motion-safe:animate-grid-drift" />
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-[34rem] w-[64rem] -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,var(--brand-teal)_0%,transparent_65%)] opacity-[0.13] blur-3xl motion-safe:animate-aurora dark:opacity-20"
      />

      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pt-12 pb-14 sm:px-6 lg:grid-cols-2 lg:pt-16">
        <div className={artFirst ? "lg:order-2" : undefined}>
          <Statement as="h1" eyebrow={eyebrow} lines={lines} lede={lede} />
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Magnetic>
              <WhatsAppCta>Book a demo on WhatsApp</WhatsAppCta>
            </Magnetic>
          </div>
        </div>
        <div className={artFirst ? "lg:order-1" : undefined}>{art}</div>
      </div>
    </section>
  );
}

/** The band every feature page ends on. */
export function ClosingBand({ title, lede }: { title: string; lede: string }) {
  return (
    <section data-motion-scope className="relative overflow-hidden py-12 sm:py-16">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,var(--brand-teal)_0%,transparent_62%)] opacity-[0.12] blur-3xl motion-safe:animate-aurora dark:opacity-20"
      />
      <div className="reveal-up mx-auto w-full max-w-3xl px-4 text-center sm:px-6">
        <h2 className="font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {title}
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-lg text-pretty text-muted-foreground">
          {lede}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Magnetic>
            <WhatsAppCta ping>Book a demo on WhatsApp</WhatsAppCta>
          </Magnetic>
        </div>
      </div>
    </section>
  );
}
