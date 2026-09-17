import Link from "next/link";
import { cn } from "@/core/lib/utils";
import { money as fmtMoney, shortNum } from "@/core/ui/charts/geometry";

/** `href` makes the row's NAME a link — a ranking is often a way in to the thing
 *  ranked, and losing that on the way to a nicer chart is a regression. */
export type LollipopRow = { label: string; value: number; sublabel?: string; href?: string };

/**
 * RANKING / COMPARISON — one measure across a few named things: collected by doctor,
 * billed by procedure, cost by category.
 *
 * A LOLLIPOP, not a bar. Both encode the value as a distance along an axis, but a bar
 * paints that whole distance while a lollipop draws a hairline and puts a dot at the
 * end. The dot is where the value actually IS, and a dot is what the eye compares
 * between rows; the filled length of a bar is ink spent re-stating the same fact. On a
 * page of six or seven of these — which is what this app had — bars read as a wall and
 * a column of dots reads as a scale.
 *
 * It also keeps the LABELS legible. They are names ("Dr Muhammad Adeel Rana",
 * "Composite filling"), so the rows run horizontally by default and the name sits on
 * its own line above the track rather than being squeezed into a column or rotated.
 *
 * `orientation="vertical"` is for a few DISCRETE periods — invoices issued per month,
 * where an area would imply the total flowed continuously between one month and the
 * next. Same encoding, turned ninety degrees.
 *
 * Pure CSS, no measuring, so it renders in a server component.
 */
export function LollipopChart({
  rows,
  formatValue = fmtMoney,
  showShare = false,
  diverging = false,
  orientation = "horizontal",
  color = "var(--color-chart-1)",
  ariaLabel = "Breakdown",
  className,
}: {
  rows: LollipopRow[];
  formatValue?: (v: number) => string;
  /** Adds each row's % of the total — only meaningful when the rows are a whole. */
  showShare?: boolean;
  /**
   * Zero in the MIDDLE, negatives running left. For a measure that can go either
   * way — a margin, a balance — where the question is which side of nothing each
   * row falls on, and by how far. A left-anchored scale answers that by asking the
   * reader to notice a colour; this answers it with a position.
   */
  diverging?: boolean;
  orientation?: "horizontal" | "vertical";
  color?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const max = rows.reduce((m, r) => Math.max(m, Math.abs(r.value)), 0) || 1;
  const total = rows.reduce((a, r) => a + Math.abs(r.value), 0) || 1;

  if (rows.length === 0) return null;

  if (orientation === "vertical") {
    // The track has a DEFINITE height (h-40), and the stem is positioned inside it.
    // Written with `flex-1` first, which silently drew every stem flat on the
    // baseline: a percentage height resolves against the parent's height, and a flex
    // item's height is auto until the browser has laid its siblings out — so every
    // `height: 62%` resolved to nothing and six different figures looked identical.
    return (
      <div className={cn("flex items-end gap-1 overflow-x-auto pb-1", className)} aria-label={ariaLabel} role="img">
        {rows.map((r, i) => {
          const h = Math.max(2, (Math.abs(r.value) / max) * 100);
          const negative = r.value < 0;
          return (
            <div
              key={`${r.label}-${i}`}
              className="group/stem flex min-w-9 flex-1 flex-col items-center gap-1.5"
              title={`${r.label}: ${formatValue(r.value)}`}
            >
              <span className="h-4 text-[10px] font-medium tabular-nums opacity-0 transition-opacity group-hover/stem:opacity-100">
                {r.value === 0 ? "" : shortNum(r.value)}
              </span>
              <div className="relative h-40 w-full">
                {/* The hairline stem, and the dot at its head — the dot is the value. */}
                <div
                  className="absolute bottom-0 left-1/2 w-px -translate-x-1/2 rounded-full transition-all duration-500"
                  style={{
                    height: `${h}%`,
                    background: negative ? "var(--color-destructive)" : color,
                    opacity: 0.45,
                  }}
                />
                <span
                  className="absolute left-1/2 size-2.5 -translate-x-1/2 translate-y-1/2 rounded-full ring-2 ring-card transition-all duration-500 group-hover/stem:size-3.5"
                  style={{
                    bottom: `${h}%`,
                    background: negative ? "var(--color-destructive)" : color,
                  }}
                  aria-hidden="true"
                />
              </div>
              <span className="w-full truncate text-center text-[10px] text-muted-foreground">
                {r.label}
              </span>
            </div>
          );
        })}
      </div>
    );
  }
  if (diverging) {
    // One scale either side of centre, so a −40k loss is exactly as long as a
    // +40k gain. Scaling each half to its own extreme would make a rounding error
    // look like a crisis next to a real one.
    const reach = rows.reduce((m, r) => Math.max(m, Math.abs(r.value)), 0) || 1;
    return (
      <ul className={cn("space-y-3.5", className)} aria-label={ariaLabel}>
        {rows.map((r, i) => {
          const negative = r.value < 0;
          const half = (Math.abs(r.value) / reach) * 50;
          return (
            <li key={`${r.label}-${i}`} className="group/row text-sm">
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate">
                  {r.label}
                  {r.sublabel ? (
                    <span className="ml-1.5 text-xs text-muted-foreground">{r.sublabel}</span>
                  ) : null}
                </span>
                <span
                  className={cn(
                    "shrink-0 font-medium tabular-nums",
                    negative ? "text-destructive-text" : "text-success-text",
                  )}
                >
                  {formatValue(r.value)}
                </span>
              </div>
              <div className="relative h-2.5">
                <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border/70" />
                {/* The centre line is the zero, and it is the strongest mark: the
                    whole chart is read as "which side of this am I on". */}
                <div className="absolute top-0 bottom-0 left-1/2 w-px -translate-x-1/2 bg-muted-foreground/40" />
                <div
                  className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full transition-all duration-500"
                  style={{
                    [negative ? "right" : "left"]: "50%",
                    width: `${half}%`,
                    background: negative
                      ? "var(--color-destructive)"
                      : "var(--color-success)",
                    opacity: 0.55,
                  }}
                />
                <span
                  className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card transition-all duration-500 group-hover/row:size-3.5"
                  style={{
                    left: `${negative ? 50 - half : 50 + half}%`,
                    background: negative
                      ? "var(--color-destructive)"
                      : "var(--color-success)",
                  }}
                  aria-hidden="true"
                />
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ul className={cn("space-y-3.5", className)} aria-label={ariaLabel}>
      {rows.map((r, i) => {
        const negative = r.value < 0;
        const pct = Math.max(1, (Math.abs(r.value) / max) * 100);
        return (
          <li key={`${r.label}-${i}`} className="group/row text-sm">
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate">
                {r.href ? (
                  <Link href={r.href} className="font-medium hover:underline">
                    {r.label}
                  </Link>
                ) : (
                  r.label
                )}
                {r.sublabel ? (
                  <span className="ml-1.5 text-xs text-muted-foreground">{r.sublabel}</span>
                ) : null}
              </span>
              <span className="flex shrink-0 items-baseline gap-2">
                {showShare ? (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {Math.round((Math.abs(r.value) / total) * 100)}%
                  </span>
                ) : null}
                <span
                  className={cn("font-medium tabular-nums", negative && "text-destructive-text")}
                >
                  {formatValue(r.value)}
                </span>
              </span>
            </div>
            {/* A 1px rule the full width of the row carries the SCALE, so every dot is
                read against the same axis rather than against its neighbour's length. */}
            <div className="relative h-2.5">
              <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border/70" />
              <div
                className="absolute top-1/2 left-0 h-0.5 -translate-y-1/2 rounded-full transition-[width] duration-500 ease-out"
                style={{
                  width: `${pct}%`,
                  background: negative
                    ? "var(--color-destructive)"
                    : `linear-gradient(to right, transparent, ${color})`,
                }}
              />
              <span
                className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card transition-all duration-500 group-hover/row:size-3.5"
                style={{
                  left: `${pct}%`,
                  background: negative ? "var(--color-destructive)" : color,
                }}
                aria-hidden="true"
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
