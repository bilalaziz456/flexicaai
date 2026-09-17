import type { ReactNode } from "react";

/**
 * Shell for the policy pages. A legal document is a different template from the rest
 * of the site: one narrow column, no artwork, and headings sized for reading rather
 * than for persuasion.
 *
 * That is why these do NOT use `Statement` or `SectionHeading`. The rule documented on
 * `Statement` governs the marketing pages, where an <h2> is either the page's argument
 * (64px) or a band label (36px). Neither describes "clause 7 of a privacy policy", and
 * forcing one of them on this page would make a contract look like a sales pitch. The
 * scale here is h1 36px, h2 20px, which collides with nothing.
 *
 * Kept deliberately plain. Someone reading a privacy policy is looking for a specific
 * answer, and every flourish is one more thing between them and it.
 */

export function LegalPage({
  title,
  updated,
  intro,
  children,
}: {
  title: string;
  /** Human-readable, e.g. "5 August 2026". */
  updated: string;
  intro: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
        <p className="mk-eyebrow">
          Legal
        </p>
        <h1 className="mk-h2 mt-6">
          {title}
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">Last updated {updated}</p>
        <div className="mt-6 space-y-4 text-base leading-relaxed text-pretty text-muted-foreground">
          {intro}
        </div>

        <div className="mt-14 space-y-12 border-t border-[var(--mk-line)] pt-12">{children}</div>
      </div>
    </section>
  );
}

export function Clause({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-bold tracking-[-0.02em] text-foreground">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

/** Bulleted list with the site's spacing, so clauses do not each invent their own. */
export function ClauseList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-1 space-y-2 pl-5">
      {items.map((item, i) => (
        <li key={i} className="list-disc marker:text-primary-text">
          {item}
        </li>
      ))}
    </ul>
  );
}
