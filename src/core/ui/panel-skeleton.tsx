import { Skeleton } from "@/core/ui/skeleton";
import { cn } from "@/core/lib/utils";

/**
 * Loading shapes — CORE. Rendered by the route `loading.tsx` boundaries the instant
 * you navigate, so the content area shows the SHAPE of what is coming instead of a
 * spinner. The surrounding PanelShell (sidebar, header) stays put.
 *
 * WHY THERE ARE SEVERAL. There used to be one, and it covered all sixty panel pages:
 * a chart report, a table of patients and a settings form all flashed the same four
 * KPI boxes and six list rows. A skeleton that does not match what arrives is worse
 * than a spinner, because the layout visibly jumps when the real content replaces it
 * — the reader is told where to look and then it moves. These are still not
 * page-exact, and should not be: they need to be right about the page's SKELETON —
 * how many columns, whether there is a chart, where the filters sit.
 */

/** The page's own title block. Every panel page starts with one. */
function TitleBlock() {
  return (
    <div className="space-y-2.5">
      <Skeleton className="h-7 w-52" />
      <Skeleton className="h-4 w-80 max-w-full" />
    </div>
  );
}

function CardShell({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-xl border border-border/70 bg-card p-5 elev-1", className)}>
      {children}
    </div>
  );
}

/** A row of KPI cards. `count` matches the grid the real page renders. */
function KpiRow({ count = 4 }: { count?: number }) {
  return (
    <div
      className={cn(
        "grid gap-4 sm:grid-cols-2",
        count === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4",
      )}
    >
      {Array.from({ length: count }).map((_, i) => (
        <CardShell key={i} className="space-y-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-3 w-24" />
        </CardShell>
      ))}
    </div>
  );
}

/** Column headings plus rows, at the table's real rhythm (h-9 head, py-3 rows). */
function TableBlock({ rows = 8, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-0">
      <div className="flex items-center gap-4 border-b border-border pb-2.5">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className={cn("h-3", i === 0 ? "w-28 flex-1" : "w-20")} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-border/55 py-3.5">
          {Array.from({ length: cols }).map((_, i) => (
            <Skeleton key={i} className={cn("h-4", i === 0 ? "w-40 flex-1" : "w-20")} />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The default, for a page whose shape is not known here. Deliberately the most
 * NEUTRAL of the set — a title and a list — rather than the old KPI-heavy guess, so
 * that being wrong costs a small correction instead of a whole grid disappearing.
 */
export function PanelSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading">
      <TitleBlock />
      <CardShell className="space-y-4">
        <Skeleton className="h-4 w-32" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="hidden h-4 w-24 sm:block" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </CardShell>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** A list page: filters, then a table. Appointments, patients, staff, recalls, logs. */
export function TableSkeleton({ rows = 8, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-6" role="status" aria-label="Loading">
      <TitleBlock />
      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-9 min-w-40 flex-1" />
      </div>
      <TableBlock rows={rows} cols={cols} />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** A report: filters, KPI row, a chart, then a breakdown. Sales, P&L, shares, finance. */
export function ReportSkeleton({ kpis = 4 }: { kpis?: number }) {
  return (
    <div className="space-y-6" role="status" aria-label="Loading">
      <TitleBlock />
      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-40" />
      </div>
      <KpiRow count={kpis} />
      <CardShell className="space-y-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-64 max-w-full" />
        {/* The chart itself — one block at the real plot height, so the page does not
            jump by 260px when it arrives. */}
        <Skeleton className="h-[260px] w-full" />
      </CardShell>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** A dashboard: KPI row, a wide chart, then a grid of smaller stats. */
export function DashboardSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading">
      <TitleBlock />
      <KpiRow count={4} />
      <CardShell className="space-y-4">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-[260px] w-full" />
      </CardShell>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <CardShell key={i} className="space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-3 w-20" />
          </CardShell>
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/** A form page: a title, then labelled fields in a card. Settings, new-record pages. */
export function FormSkeleton({ fields = 6 }: { fields?: number }) {
  return (
    <div className="space-y-6" role="status" aria-label="Loading">
      <TitleBlock />
      <CardShell className="space-y-5">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-9 w-full max-w-md" />
          </div>
        ))}
        <Skeleton className="h-9 w-32" />
      </CardShell>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
