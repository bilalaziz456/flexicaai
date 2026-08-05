import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/core/lib/utils";

export type Crumb = { label: string; href?: string };

/**
 * Breadcrumb trail — CORE. Wayfinding for deep routes (clinic detail, import, patient/
 * appointment detail) so a user who deep-links or refreshes knows where they are and can
 * step back up — instead of a lone "← Back" link (recognition over recall; Nielsen #1).
 * The last item is the current page (not a link). Semantic `<nav><ol>` for screen readers.
 */
export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn("text-sm text-muted-foreground", className)}>
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1">
              {c.href && !last ? (
                <Link href={c.href} className="rounded-sm underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 hover:text-foreground hover:underline">
                  {c.label}
                </Link>
              ) : (
                <span className={last ? "font-medium text-foreground" : undefined} aria-current={last ? "page" : undefined}>
                  {c.label}
                </span>
              )}
              {!last ? <ChevronRight className="size-3.5 shrink-0 opacity-60" aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
