import type { ReactNode } from "react";
import type { Crumb } from "@/site/lib/site";
import { Breadcrumbs, Container, Eyebrow } from "@/site/components/ui";

/**
 * Shell for the policy pages: a short dark band (the fixed header is light-on-dark)
 * and then one narrow, plain reading column. Someone reading a privacy policy is
 * looking for a specific answer, and every flourish is one more thing in the way.
 */
export function LegalPage({
  title,
  updated,
  intro,
  crumbs,
  children,
}: {
  title: string;
  /** Human-readable, e.g. "5 August 2026". */
  updated: string;
  intro: ReactNode;
  crumbs: Crumb[];
  children: ReactNode;
}) {
  return (
    <>
      <section className="band-dark grain relative overflow-hidden pb-14 pt-28 sm:pt-32 lg:pb-16 lg:pt-40">
        <Container className="relative max-w-3xl">
          <Breadcrumbs crumbs={crumbs} dark />
          <Eyebrow dark className="mt-8">
            Legal
          </Eyebrow>
          <h1 className="text-h1 mt-5 text-white">{title}</h1>
          <p className="mt-5 text-sm text-slate-400">Last updated {updated}</p>
        </Container>
      </section>
      <section className="bg-white py-14 sm:py-20">
        <Container className="max-w-3xl">
          <div className="space-y-4 text-[1.05rem] leading-relaxed text-pretty text-ink-soft">{intro}</div>
          <div className="mt-12 space-y-12 border-t border-mist-200 pt-12">{children}</div>
        </Container>
      </section>
    </>
  );
}

export function Clause({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold tracking-[-0.02em] text-ink">{title}</h2>
      <div className="mt-3 space-y-3 text-[0.98rem] leading-relaxed text-ink-soft">{children}</div>
    </section>
  );
}

/** Bulleted list with the site's spacing, so clauses do not each invent their own. */
export function ClauseList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-1 space-y-2 pl-5">
      {items.map((item, i) => (
        <li key={i} className="list-disc marker:text-teal-ink">
          {item}
        </li>
      ))}
    </ul>
  );
}

/** Emphasis inside a clause. */
export function Strong({ children }: { children: ReactNode }) {
  return <span className="font-medium text-ink">{children}</span>;
}

export const LINK_CLASS = "text-ink underline underline-offset-4 hover:text-teal-ink";
