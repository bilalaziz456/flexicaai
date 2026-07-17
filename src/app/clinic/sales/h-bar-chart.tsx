"use client";

export type HBarRow = { label: string; value: number; sublabel?: string };

const money = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 });

/**
 * Horizontal ranked bar chart — the canonical form for "compare one measure across a
 * few categories" (revenue by doctor, billed by procedure, cost by category). Rows are
 * caller-ordered (usually desc); each bar's width is proportional to the row's share of
 * the largest value, with the exact figure on the right so it doubles as a table. A
 * single teal hue (one measure = one hue, not categorical). Pure CSS/flex — responsive
 * and needs no measuring; works in a server component.
 */
export function HBarChart({
  rows,
  formatValue = (v) => money.format(v),
  ariaLabel = "Breakdown",
}: {
  rows: HBarRow[];
  formatValue?: (v: number) => string;
  ariaLabel?: string;
}) {
  // Size bars by MAGNITUDE so a negative value (e.g. a doctor who net-bore a discount)
  // still reads sensibly — shown red and sized by |value|.
  const max = rows.reduce((m, r) => Math.max(m, Math.abs(r.value)), 0) || 1;
  return (
    <ul className="space-y-2.5" aria-label={ariaLabel}>
      {rows.map((r, i) => (
        <li key={`${r.label}-${i}`} className="text-sm">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate">
              {r.label}
              {r.sublabel ? <span className="ml-1.5 text-xs text-muted-foreground">{r.sublabel}</span> : null}
            </span>
            <span className={`shrink-0 font-medium tabular-nums ${r.value < 0 ? "text-destructive" : ""}`}>{formatValue(r.value)}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${r.value < 0 ? "bg-destructive" : "bg-[var(--color-chart-1)]"}`}
              style={{ width: `${Math.max(2, Math.round((Math.abs(r.value) / max) * 100))}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
