import { Skeleton } from "@/core/ui/skeleton";

/**
 * Content-shaped panel loading state — CORE. Rendered by each panel's `loading.tsx`
 * the instant you navigate, so the content area shows a skeleton of the typical page
 * shape (title → KPI cards → a list/table) instead of a bare spinner. Not page-exact,
 * but "your content is arriving" reads far faster than "waiting" (Linear/Vercel-style).
 * The surrounding PanelShell (sidebar/header) stays put.
 */
export function PanelSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading">
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>

      {/* KPI card grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>

      {/* List / table */}
      <div className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <Skeleton className="h-4 w-32" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="hidden h-4 w-24 sm:block" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
