"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/core/lib/utils";
import { RowLink } from "@/core/ui/row-link";

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
};

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
  stickyHeader = false,
  initialSort,
  minWidthClassName,
  rowHref,
  className,
}: {
  rows: T[];
  columns: Column<T>[];
  getRowKey: (row: T, index: number) => string;
  empty?: React.ReactNode;
  stickyHeader?: boolean;
  initialSort?: SortState;
  /** e.g. "min-w-[48rem]" to force horizontal scroll before columns crush. */
  minWidthClassName?: string;
  /** When set, the whole row (and mobile card) navigates here on click — clicks on
   *  inner links/buttons still work (via RowLink). Keyboard: Enter/Space opens. */
  rowHref?: (row: T) => string;
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
    return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  }

  const titleCol = columns.find((c) => c.cardTitle);
  const cardCols = columns.filter((c) => !c.hideOnCard && !c.cardTitle);
  const labelOf = (c: Column<T>) => c.label ?? (typeof c.header === "string" ? c.header : "");
  const hasFooter = columns.some((c) => c.footer);

  return (
    <div className={className}>
      {/* Desktop / tablet: the table */}
      <div className="hidden overflow-x-auto md:block">
        <table className={cn("w-full text-sm", minWidthClassName)}>
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              {columns.map((c) => {
                const active = sort?.id === c.id;
                return (
                  <th
                    key={c.id}
                    className={cn(
                      "pb-2 font-normal",
                      stickyHeader && "sticky top-0 z-10 bg-background",
                      c.align && alignClass[c.align],
                      c.headerClassName,
                    )}
                  >
                    {c.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.id)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                          c.align === "right" && "flex-row-reverse",
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
            {sorted.map((row, i) => {
              const cells = columns.map((c) => (
                <td key={c.id} className={cn("py-2 align-middle", c.align && alignClass[c.align], c.cellClassName)}>
                  {c.cell(row)}
                </td>
              ));
              return rowHref ? (
                <RowLink key={getRowKey(row, i)} as="tr" href={rowHref(row)} className="border-b last:border-0">
                  {cells}
                </RowLink>
              ) : (
                <tr key={getRowKey(row, i)} className="border-b transition-colors last:border-0 hover:bg-muted/40">
                  {cells}
                </tr>
              );
            })}
          </tbody>
          {hasFooter ? (
            <tfoot>
              <tr className="border-t font-medium">
                {columns.map((c) => (
                  <td key={c.id} className={cn("py-2 align-middle", c.align && alignClass[c.align], c.cellClassName)}>
                    {c.footer ? c.footer() : null}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {/* Mobile: each row as a card */}
      <ul className="space-y-2 md:hidden">
        {sorted.map((row, i) => {
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
            <RowLink key={getRowKey(row, i)} as="li" href={rowHref(row)} className="block rounded-lg border p-3 text-sm">
              {inner}
            </RowLink>
          ) : (
            <li key={getRowKey(row, i)} className="rounded-lg border p-3 text-sm">
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
