import { cn } from "@/core/lib/utils";

export type HBarRow = { label: string; value: number; sublabel?: string };

const money = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0,
});

/**
 * RANKING — one measure across a few named things: revenue by doctor, billed by
 * procedure, cost by category. Rows are caller-ordered (usually descending); each
 * bar is the row's share of the largest value, with the exact figure beside it, so
 * the chart doubles as the table it replaces.
 *
 * Horizontal, because the labels are NAMES. Vertical bars would either rotate them
 * to 45° or truncate them, and "Dr Muhammad Adeel Rana" is not a thing you want to
 * read sideways.
 *
 * A single hue with a left-to-right fade, not a colour per row: there is one measure
 * here, and giving each row its own colour implies a categorical difference the data
 * does not have. Length is the encoding; colour only carries SIGN — a negative value
 * (a doctor who net-bore a discount) goes red and is sized by magnitude, so it still
 * ranks sensibly.
 *
 * Pure CSS, no measuring, renders in a server component.
 */
export function HBarChart({
  rows,
  formatValue = (v) => money.format(v),
  showShare = false,
  ariaLabel = "Breakdown",
}: {
  rows: HBarRow[];
  formatValue?: (v: number) => string;
  /** Adds each row's % of the total — only meaningful when the rows are a whole. */
  showShare?: boolean;
  ariaLabel?: string;
}) {
  const max = rows.reduce((m, r) => Math.max(m, Math.abs(r.value)), 0) || 1;
  const total = rows.reduce((a, r) => a + Math.abs(r.value), 0) || 1;

  return (
    <ul className="space-y-3" aria-label={ariaLabel}>
      {rows.map((r, i) => {
        const negative = r.value < 0;
        const pct = Math.max(1.5, (Math.abs(r.value) / max) * 100);
        return (
          <li key={`${r.label}-${i}`} className="group/row text-sm">
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate">
                {r.label}
                {r.sublabel ? (
                  <span className="ml-1.5 text-xs text-muted-foreground">{r.sublabel}</span>
                ) : null}
              </span>
              <span className="flex shrink-0 items-baseline gap-2">
                {showShare ? (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {Math.round((Math.abs(r.value) / total) * 100)}%
                  </span>
                ) : null}
                <span
                  className={cn(
                    "font-medium tabular-nums",
                    negative && "text-destructive-text",
                  )}
                >
                  {formatValue(r.value)}
                </span>
              </span>
            </div>
            {/* 6px, fully rounded, on a barely-there track: a ranked list is read
                down the labels, and a heavy bar turns that into a bar chart you
                have to look past. */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/70">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-500 ease-out",
                  negative
                    ? "bg-destructive/80"
                    : "bg-linear-to-r from-[var(--color-chart-1)] to-[var(--color-chart-2)]",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
