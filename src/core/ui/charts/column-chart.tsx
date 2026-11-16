import { money as fmtMoney, shortNum } from "@/core/ui/charts/geometry";

export type ColumnRow = { label: string; value: number };

/**
 * Colours a column chart cycles through when each column gets its own (`multicolor`).
 * The five chart tokens (themed for light and dark) and three more hues from the same
 * lightness band, so neighbouring months never share a colour.
 */
const COLUMN_PALETTE = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "oklch(0.62 0.17 295)",
  "oklch(0.7 0.15 155)",
  "var(--color-chart-3)",
  "oklch(0.68 0.16 340)",
];

/**
 * COLUMNS — one measure per DISCRETE period (invoiced per month). Each column a solid
 * bar from the baseline with its value printed above it.
 *
 * `multicolor` gives every column its own colour (owner's call, 2026-11-17, for
 * "Invoiced over time"). The colour carries no meaning there — the label under each
 * column says which month it is — so no legend is drawn; without it every column takes
 * `color`.
 *
 * The track has a DEFINITE height (h-44): a percentage height inside a flex item whose
 * own height is still auto resolves to nothing (see `VerticalLollipop`).
 * Below `sm` it turns into rows — thirteen columns do not fit a phone.
 * Pure CSS, no measuring, so it renders in a server component.
 */
export function ColumnChart({
  rows,
  formatValue = fmtMoney,
  multicolor = false,
  color = "var(--color-chart-1)",
  ariaLabel = "Chart",
  className,
}: {
  rows: ColumnRow[];
  formatValue?: (v: number) => string;
  multicolor?: boolean;
  color?: string;
  ariaLabel?: string;
  className?: string;
}) {
  if (rows.length === 0) return null;
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0) || 1;
  const colorAt = (i: number) => (multicolor ? COLUMN_PALETTE[i % COLUMN_PALETTE.length] : color);

  return (
    <div className={className} role="img" aria-label={ariaLabel}>
      {/* Phone: one row per period, the bar running across. */}
      <ul className="space-y-2 sm:hidden">
        {rows.map((r, i) => (
          <li key={`${r.label}-${i}`} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2 text-xs">
            <span className="truncate text-muted-foreground">{r.label}</span>
            <div className="h-3 rounded-sm bg-muted">
              <div
                className="h-full rounded-sm"
                style={{ width: `${Math.max(r.value > 0 ? 2 : 0, (r.value / max) * 100)}%`, background: colorAt(i) }}
              />
            </div>
            <span className="tabular-nums">{r.value === 0 ? "—" : shortNum(r.value)}</span>
          </li>
        ))}
      </ul>

      {/* Wider: columns. */}
      <div className="hidden items-end gap-2 sm:flex">
        {rows.map((r, i) => {
          const h = r.value > 0 ? Math.max(2, (r.value / max) * 100) : 0;
          return (
            <div
              key={`${r.label}-${i}`}
              className="group/col flex min-w-0 flex-1 flex-col items-center gap-1.5"
              title={`${r.label}: ${formatValue(r.value)}`}
            >
              <div className="relative h-44 w-full">
                <div
                  className="absolute inset-x-[12%] bottom-0 flex flex-col items-center transition-all duration-500"
                  style={{ height: `${h}%` }}
                >
                  <span className="absolute -top-5 whitespace-nowrap text-[10px] font-semibold tabular-nums text-foreground/80">
                    {r.value === 0 ? "" : shortNum(r.value)}
                  </span>
                  <div
                    className="h-full w-full rounded-t-md opacity-90 transition-opacity group-hover/col:opacity-100"
                    style={{ background: colorAt(i) }}
                  />
                </div>
              </div>
              <span className="w-full truncate border-t pt-1.5 text-center text-[10px] text-muted-foreground">{r.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
