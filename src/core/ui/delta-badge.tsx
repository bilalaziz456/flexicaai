import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/core/lib/utils";

/**
 * KPI trend delta — CORE. Shows the % change of a metric vs a previous period with an
 * up/down arrow, coloured by whether the direction is GOOD (revenue up = green; expenses
 * up = red — set `higherIsBetter`). Renders nothing when there's no prior baseline (so a
 * brand-new clinic doesn't show a misleading ∞%). Works with negative bases (a shrinking
 * loss reads as an improvement).
 */
export function DeltaBadge({
  current,
  previous,
  higherIsBetter = true,
  className,
}: {
  current: number;
  previous: number;
  higherIsBetter?: boolean;
  className?: string;
}) {
  // No comparable baseline → don't invent a percentage.
  if (previous === 0) return null;

  const pct = Math.round(((current - previous) / Math.abs(previous)) * 100);
  if (pct === 0) {
    return <span className={cn("text-xs font-medium text-muted-foreground", className)}>±0%</span>;
  }

  const up = pct > 0;
  const good = up === higherIsBetter;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn("inline-flex items-center gap-0.5 text-xs font-medium", good ? "text-success" : "text-destructive", className)}
    >
      <Icon className="size-3" aria-hidden="true" />
      {Math.abs(pct)}%
      <span className="sr-only">{up ? "up" : "down"} vs previous 30 days</span>
    </span>
  );
}
