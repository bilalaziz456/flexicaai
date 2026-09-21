import { cn } from "@/core/lib/utils";

/**
 * Skeleton — CORE. A content-shaped placeholder block. Size it with `className`
 * (`h-4 w-32`, etc.). Used by the route `loading.tsx` boundaries and the shape
 * skeletons in `panel-skeleton.tsx`.
 *
 * It SWEEPS rather than pulses. A block fading in and out says "something is here,
 * blinking"; a highlight travelling across it says "this is filling in", which reads
 * as progress — and perceived progress is the entire job of a skeleton, since neither
 * animation knows anything about the actual request.
 *
 * `motion-reduce` drops the sweep and leaves the block, so the layout still holds for
 * anyone who has asked the system to stop moving things.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md bg-foreground/[0.07]",
        "after:absolute after:inset-0 after:-translate-x-full after:animate-[skeleton-sweep_1.6s_ease-in-out_infinite] after:bg-gradient-to-r after:from-transparent after:via-foreground/[0.06] after:to-transparent",
        "motion-reduce:after:animate-none",
        className,
      )}
      aria-hidden="true"
    />
  );
}
