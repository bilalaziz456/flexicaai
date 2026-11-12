import type { ReactNode } from "react";
import { WHATSAPP_URL } from "../../lib/contact";
import { DEMO_PATH } from "../../lib/nav";
import type { Crumb } from "../../lib/site";
import { Breadcrumbs, ButtonLink, Container, Eyebrow, cx } from "../ui";
import { Ambient } from "./rich";

/**
 * Building blocks for inner pages. Every page opens on a dark band (the fixed header
 * is light-on-dark), then alternates light and dark bands.
 */

export function PageHero({
  crumbs,
  eyebrow,
  title,
  lead,
  children,
  aside,
}: {
  crumbs?: Crumb[];
  eyebrow?: string;
  title: ReactNode;
  lead?: ReactNode;
  /** Extra content under the lead (buttons etc.). */
  children?: ReactNode;
  /** Optional visual on the right on wide screens. */
  aside?: ReactNode;
}) {
  return (
    <section data-hero className="band-dark grain relative overflow-hidden pb-20 pt-28 sm:pt-32 lg:pb-28 lg:pt-40">
      <div className="pointer-events-none absolute inset-0 grid-dots-dark [mask-image:radial-gradient(ellipse_70%_60%_at_70%_30%,black,transparent)]" aria-hidden />
      <Container className={cx("relative", !!aside && "grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]")}>
        <div className="max-w-3xl">
          {crumbs && <Breadcrumbs crumbs={crumbs} dark />}
          {eyebrow && <Eyebrow dark className={crumbs ? "mt-8" : undefined}>{eyebrow}</Eyebrow>}
          <h1 className="text-h1 mt-5 text-white">{title}</h1>
          {lead && <p className="text-lead mt-6 max-w-2xl text-slate-300">{lead}</p>}
          {children && <div data-hero-cta className="mt-9">{children}</div>}
        </div>
        {aside && <div data-hero-aside className="relative">{aside}</div>}
      </Container>
    </section>
  );
}

/** Standard demo CTA pair. */
export function CtaButtons({ dark = true }: { dark?: boolean }) {
  return (
    <div className="flex flex-wrap gap-3">
      <ButtonLink href={DEMO_PATH} arrow>
        Book a personalised demo
      </ButtonLink>
      <ButtonLink href={WHATSAPP_URL} tone={dark ? "ghost-dark" : "ghost-light"}>
        WhatsApp us
      </ButtonLink>
    </div>
  );
}

/** The closing call to action at the bottom of inner pages. */
export function CtaBand({
  title = "See FlexicaAI with your own clinic's day.",
  text = "We walk through FlexicaAI around how your clinic books, records and bills — then set your account up for you.",
}: {
  title?: string;
  text?: string;
}) {
  return (
    <section className="bg-mist py-20 lg:py-28" aria-labelledby="cta-band-title">
      <Container>
        <div className="band-dark grain relative overflow-hidden rounded-[2rem] px-6 py-14 text-center sm:px-12 lg:py-20">
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-[radial-gradient(ellipse_60%_70%_at_50%_120%,rgb(15_180_187/0.25),transparent_70%)]" aria-hidden />
          <h2 id="cta-band-title" className="text-h2 relative mx-auto max-w-3xl text-white">
            {title}
          </h2>
          <p className="text-lead relative mx-auto mt-5 max-w-2xl text-slate-300">{text}</p>
          <div className="relative mt-9 flex justify-center">
            <CtaButtons />
          </div>
        </div>
      </Container>
    </section>
  );
}

/** A light content band. */
export function Band({
  children,
  className,
  tone = "mist",
  labelledBy,
  id,
  ambient = false,
}: {
  children: ReactNode;
  className?: string;
  tone?: "mist" | "white" | "dark";
  labelledBy?: string;
  id?: string;
  /** Drifting colour light and a dot grid behind the content. */
  ambient?: boolean;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cx(
        "relative py-20 lg:py-28",
        tone === "mist" && "bg-mist",
        tone === "white" && "bg-white",
        tone === "dark" && "band-dark grain overflow-hidden",
        ambient && "overflow-hidden",
        className,
      )}
    >
      {ambient && <Ambient dark={tone === "dark"} />}
      <Container className="relative">{children}</Container>
    </section>
  );
}
