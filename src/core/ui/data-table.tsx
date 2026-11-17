"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, type LucideIcon } from "lucide-react";
import { SelectField } from "@/core/ui/select-field";
import { cn } from "@/core/lib/utils";
import { RowLink } from "@/core/ui/row-link";
import { EmptyState } from "@/core/ui/empty-state";

/**
 * Shared data table — CORE. One consistent implementation for the app's list/ledger
 * screens, replacing the hand-rolled `<table>`s that each re-did header styling,
 * density, sorting (none), and responsive behaviour. Gives, for free:
 *  - client-side **sorting** on any column with a `sortValue`,
 *  - an optional **sticky header** (stays visible while the page scrolls),
 *  - a real **empty state**,
 *  - a **mobile card** view (each row collapses to a card below `md`).
 *
 * Client component. A server page fetches + serialises its rows, then a small client
 * wrapper defines the columns (with `cell` render fns + links) and renders this.
 */

export type Align = "left" | "right" | "center";

export type Column<T> = {
  /** Stable id (used for the sort key + React key). */
  id: string;
  /** Header content (usually a string; used as the mobile card label too). */
  header: React.ReactNode;
  /** Explicit label for the mobile card view when `header` isn't a plain string. */
  label?: string;
  /** Cell content for a row. */
  cell: (row: T) => React.ReactNode;
  /** Return a comparable value to make this column sortable (omit = not sortable). */
  sortValue?: (row: T) => string | number;
  align?: Align;
  headerClassName?: string;
  cellClassName?: string;
  /** Hide this column in the mobile card view (e.g. redundant with the title). */
  hideOnCard?: boolean;
  /** Render this column as the card's title (mobile). At most one. */
  cardTitle?: boolean;
  /** A totals-row cell for this column. If ANY column has one, a footer renders. */
  footer?: () => React.ReactNode;
  /** Screen only: left off paper and out of a downloaded PDF (row buttons, menus).
   *  A column with id "actions" is screen-only without saying so. */
  screenOnly?: boolean;
};

/** Row buttons have no meaning on paper, so an "actions" column never reaches it. */
const paperClass = <T,>(c: Column<T>) => (c.screenOnly || c.id === "actions" ? "no-print" : undefined);

type SortState = { id: string; dir: "asc" | "desc" };

const alignClass: Record<Align, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export function DataTable<T>({
  rows,
  columns,
  getRowKey,
  empty = "Nothing to show.",
  emptyIcon,
  stickyHeader = false,
  initialSort,
  minWidthClassName,
  rowHref,
  paginate,
  className,
}: {
  rows: T[];
  columns: Column<T>[];
  getRowKey: (row: T, index: number) => string;
  empty?: React.ReactNode;
  /** Optional icon for the (designed) empty state. */
  emptyIcon?: LucideIcon;
  stickyHeader?: boolean;
  initialSort?: SortState;
  /** e.g. "min-w-[48rem]" to force horizontal scroll before columns crush. */
  minWidthClassName?: string;
  /** When set, the whole row (and mobile card) navigates here on click — clicks on
   *  inner links/buttons still work (via RowLink). Keyboard: Enter/Space opens. */
  rowHref?: (row: T) => string;
  /**
   * Pages the rows IN THE BROWSER — for a table whose rows all arrive already (a
   * clinic's payment history), where a server round trip per page buys nothing.
   * `sizes` are the "N / page" choices, the first being the default. Sorting runs over
   * every row first, so page 1 sorted by date is the newest of ALL rows. A list too
   * big to send whole pages on the server instead (`Pagination`).
   */
  paginate?: { sizes: readonly number[] };
  className?: string;
}) {
  const [sort, setSort] = useState<SortState | undefined>(initialSort);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sortValue) return rows;
    const val = col.sortValue;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return 0;
    });
  }, [rows, sort, columns]);

  const [pageSize, setPageSize] = useState(paginate?.sizes[0] ?? 0);
  const [page, setPage] = useState(1);
  const pageCount = paginate ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const current = Math.min(page, pageCount);
  const shown = paginate ? sorted.slice((current - 1) * pageSize, current * pageSize) : sorted;

  function toggleSort(id: string) {
    setSort((prev) =>
      prev?.id === id
        ? prev.dir === "asc"
          ? { id, dir: "desc" }
          : undefined // asc → desc → off
        : { id, dir: "asc" },
    );
  }

  if (rows.length === 0) {
    return <EmptyState compact icon={emptyIcon} title={empty} />;
  }

  const titleCol = columns.find((c) => c.cardTitle);
  const cardCols = columns.filter((c) => !c.hideOnCard && !c.cardTitle);
  const labelOf = (c: Column<T>) => c.label ?? (typeof c.header === "string" ? c.header : "");
  const hasFooter = columns.some((c) => c.footer);

  return (
    <div className={className}>
      {/* The pager sits ABOVE the table (owner, 2026-11-17), where the size choice
          and the page arrows are seen before scrolling through the rows. */}
      {paginate && sorted.length > paginate.sizes[0] ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground" data-no-pdf>
          <span className="tabular-nums">
            {(current - 1) * pageSize + 1}–{Math.min(current * pageSize, sorted.length)} of {sorted.length}
          </span>
          <div className="flex items-center gap-2">
            <SelectField
              value={String(pageSize)}
              onValueChange={(v) => {
                setPageSize(Number(v));
                setPage(1);
              }}
              options={paginate.sizes.map((n) => ({ value: String(n), label: `${n} / page` }))}
              ariaLabel="Rows per page"
              align="end"
              size="sm"
              className="w-28"
              popupClassName="min-w-28"
            />
            <button
              type="button"
              className="inline-flex size-7 items-center justify-center rounded-md border hover:bg-muted disabled:opacity-40"
              onClick={() => setPage(current - 1)}
              disabled={current <= 1}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </button>
            <span className="tabular-nums">
              Page {current} of {pageCount}
            </span>
            <button
              type="button"
              className="inline-flex size-7 items-center justify-center rounded-md border hover:bg-muted disabled:opacity-40"
              onClick={() => setPage(current + 1)}
              disabled={current >= pageCount}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
      {/* Desktop / tablet: the table */}
      <div className="hidden overflow-x-auto md:block">
        <table className={cn("w-full text-sm", minWidthClassName)}>
          <thead>
            <tr className="border-b border-border text-left text-2xs font-semibold tracking-[0.07em] text-muted-foreground uppercase">
              {columns.map((c) => {
                const active = sort?.id === c.id;
                return (
                  <th
                    key={c.id}
                    className={cn(
                      "pb-2.5 font-semibold",
                      stickyHeader && "sticky top-0 z-10 bg-background",
                      c.align && alignClass[c.align],
                      c.headerClassName,
                      paperClass(c),
                    )}
                  >
                    {c.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.id)}
                        className={cn(
                          // `uppercase` is repeated here on purpose: a BUTTON does not inherit
                          // text-transform (browsers reset it on form elements), so the sortable
                          // columns rendered Title Case while the non-sortable ones beside them
                          // were uppercase — two header styles inside one table.
                          "inline-flex min-h-6 items-center gap-1 rounded text-2xs font-semibold tracking-[0.07em] uppercase outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60",
                          // The arrow is always AFTER the heading (owner, 2026-11-17). It was
                          // flipped before the label on right-aligned columns, so one table had
                          // arrows on both sides.
                          active && "text-foreground",
                        )}
                        aria-label={`Sort by ${labelOf(c)}`}
                      >
                        {c.header}
                        {active ? (
                          sort!.dir === "asc" ? (
                            <ArrowUp className="size-3" aria-hidden="true" />
                          ) : (
                            <ArrowDown className="size-3" aria-hidden="true" />
                          )
                        ) : (
                          <ChevronsUpDown className="size-3 opacity-40" aria-hidden="true" />
                        )}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => {
              const cells = columns.map((c) => (
                <td key={c.id} className={cn("py-3 align-middle", c.align && alignClass[c.align], c.cellClassName, paperClass(c))}>
                  {c.cell(row)}
                </td>
              ));
              return rowHref ? (
                <RowLink
                  key={getRowKey(row, i)}
                  as="tr"
                  href={rowHref(row)}
                  className="border-b border-border/55 transition-colors duration-100 last:border-0 hover:bg-foreground/[0.028]"
                >
                  {cells}
                </RowLink>
              ) : (
                <tr
                  key={getRowKey(row, i)}
                  className="border-b border-border/55 transition-colors duration-100 last:border-0 hover:bg-foreground/[0.028]"
                >
                  {cells}
                </tr>
              );
            })}
          </tbody>
          {hasFooter ? (
            <tfoot>
              <tr className="border-t font-medium">
                {columns.map((c) => (
                  <td key={c.id} className={cn("py-3 align-middle", c.align && alignClass[c.align], c.cellClassName, paperClass(c))}>
                    {c.footer ? c.footer() : null}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {/* Mobile: each row as a card */}
      <ul className="divide-y divide-border/60 rounded-lg border border-border/60 md:hidden">
        {shown.map((row, i) => {
          const inner = (
            <>
              {titleCol ? <div className="mb-1 font-medium">{titleCol.cell(row)}</div> : null}
              <dl className="grid gap-y-1 text-xs">
                {cardCols.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">{labelOf(c)}</dt>
                    <dd className="text-right">{c.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            </>
          );
          return rowHref ? (
            <RowLink key={getRowKey(row, i)} as="li" href={rowHref(row)} className="block p-3 text-sm">
              {inner}
            </RowLink>
          ) : (
            <li key={getRowKey(row, i)} className="p-3 text-sm">
              {inner}
            </li>
          );
        })}
      </ul>
      {hasFooter ? (
        <div className="mt-2 rounded-lg border bg-muted/30 p-3 text-sm font-medium md:hidden">
          <dl className="grid gap-y-1 text-xs">
            {columns
              .filter((c) => c.footer && !c.cardTitle)
              .map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">{labelOf(c)}</dt>
                  <dd className="text-right">{c.footer!()}</dd>
                </div>
              ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}
