import type { LucideIcon } from "lucide-react";
import { cn } from "@/core/lib/utils";

/**
 * Designed empty state — CORE. A centred icon + title (+ optional description / CTA)
 * for "no data yet" moments, instead of a bare line of muted text. Used by `DataTable`
 * and directly on pages/cards. Purely presentational.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  /** Tighter padding for use inside a card/table (vs a full-page empty). */
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 px-4 text-center",
        compact ? "py-8" : "py-12",
        className,
      )}
    >
      {Icon ? (
        <div className="mb-1 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </div>
      ) : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
