import { cn } from "@/core/lib/utils";

/**
 * Skeleton — CORE. A pulsing muted placeholder block for content-shaped loading
 * states (far better perceived performance than a spinner). Size it with `className`
 * (`h-4 w-32`, etc.). Used by `PanelSkeleton` + route `loading.tsx` boundaries.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} aria-hidden="true" />;
}
