import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";
import { PageSizeSelect } from "@/core/ui/page-size-select";

// Query keys that must NOT be carried into page links: the page cursor itself,
// and one-shot flash flags (they'd re-fire a success toast on every page click).
const EXCLUDED_KEYS = new Set(["page", "created", "updated", "deleted"]);

/**
 * Pagination bar (server component) — "Showing X–Y of Z" plus Prev/Next that
 * preserve the current filters (every query param except `page` and the flash
 * flags). Renders nothing when there's nothing to show. `unit` labels the count
 * (e.g. "patient"). CORE, list-agnostic.
 */
/**
 * English plural for the unit label. The old rule was `unit + "s"`, which is right
 * for "expense" and "clinic" and wrong for the ones ending in a consonant + y —
 * `unit="entry"` printed "entrys", on the admin logs page as well as here.
 */
function plural(unit: string, total: number): string {
  if (total === 1) return unit;
  if (/[^aeiou]y$/i.test(unit)) return `${unit.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(unit)) return `${unit}es`;
  return `${unit}s`;
}

export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  searchParams,
  unit = "result",
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  searchParams: Record<string, string | undefined>;
  unit?: string;
}) {
  if (total <= 0) return null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // A page past the end reads "Showing 21–6 of 6" otherwise — an arithmetic artefact
  // printed as if it were a fact. Anyone can type `?page=9`, and a list that shrinks
  // (a filter narrowed, a row deleted) puts a reader there without them doing
  // anything at all.
  const beyondEnd = (page - 1) * pageSize >= total;
  const from = beyondEnd ? 0 : (page - 1) * pageSize + 1;
  const to = beyondEnd ? 0 : Math.min(page * pageSize, total);

  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v && !EXCLUDED_KEYS.has(k)) sp.set(k, v);
    }
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `${basePath}?${s}` : basePath;
  };

  const navCls = cn(buttonVariants({ variant: "outline", size: "sm" }));
  const disabledCls =
    "inline-flex h-8 items-center gap-1 rounded-md border px-3 text-sm text-muted-foreground opacity-50";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">
        {beyondEnd ? "Showing 0" : `Showing ${from}–${to}`} of {total} {plural(unit, total)}
      </span>
      <div className="flex items-center gap-2">
        {/* Rows-per-page — always available, even on a single page. */}
        <PageSizeSelect
          size={pageSize}
          basePath={basePath}
          searchParams={searchParams}
        />
        {totalPages > 1 ? (
          <>
            {page > 1 ? (
              <Link href={href(page - 1)} className={navCls} scroll={false}>
                <ChevronLeft className="size-4" aria-hidden="true" />
                Prev
              </Link>
            ) : (
              <span className={disabledCls} aria-disabled="true">
                <ChevronLeft className="size-4" aria-hidden="true" />
                Prev
              </span>
            )}
            <span className="text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            {page < totalPages ? (
              <Link href={href(page + 1)} className={navCls} scroll={false}>
                Next
                <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            ) : (
              <span className={disabledCls} aria-disabled="true">
                Next
                <ChevronRight className="size-4" aria-hidden="true" />
              </span>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
