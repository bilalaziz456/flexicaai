import type { ReactNode } from "react";
import { cn } from "@/core/lib/utils";

/**
 * The block every panel page opens with: what this page is, one line about it, and
 * the actions that belong to the page as a whole.
 *
 * Every one of the sixty panel pages had hand-written this, and they had drifted —
 * `text-xl` here and `text-2xl` there, `items-center` on one and `items-start` on the
 * next, the description sometimes a sibling of the title and sometimes nested inside
 * it. None of that is visible on any single page; it is only visible when you move
 * between them, which is exactly the kind of inconsistency that makes an application
 * feel assembled rather than designed.
 *
 * `actions` wrap under the title on a narrow screen rather than squeezing it, because
 * the title is what tells you where you are and a truncated page name is worse than a
 * button on a second row.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-3", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
