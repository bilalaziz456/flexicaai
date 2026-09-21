"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, RotateCw } from "lucide-react";
import { Button, buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";

/**
 * The in-panel error state — CORE.
 *
 * There was exactly one `error.tsx` in the app, at the root, so an error thrown by any
 * one of the sixty panel pages was caught at the very top and replaced the ENTIRE
 * screen: sidebar, header, the lot. That is the wrong blast radius. What failed was
 * one page's data; the navigation around it is still perfectly good, and taking it
 * away leaves the reader with nowhere to go but the browser's back button.
 *
 * Rendered by a segment-level boundary, this fails INSIDE the content area, so the
 * shell stays and the next page is one click away.
 *
 * Tone follows the brief: informative, not alarming. It says what failed and what to
 * do, and the `digest` is included because it is the one thing that makes a support
 * conversation about a specific failure possible — it is a reference, never a stack
 * trace, and nothing about the error itself is shown to the user.
 */
export function ErrorState({
  error,
  reset,
  /** Where "back" goes — the panel's own home, not the site root. */
  backHref,
  backLabel,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  backHref: string;
  backLabel: string;
}) {
  useEffect(() => {
    // Surfaced for logging; never rendered raw.
    console.error(error);
  }, [error]);

  return (
    <div
      role="alert"
      className="flex min-h-[26rem] flex-col items-center justify-center gap-5 px-4 py-12 text-center"
    >
      <div className="flex size-12 items-center justify-center rounded-full border border-dashed border-warning/40 bg-warning/8 text-warning-text">
        <AlertTriangle className="size-5" aria-hidden="true" />
      </div>

      <div className="space-y-2">
        <h2 className="font-display text-lg font-semibold tracking-[-0.015em]">
          This page didn&apos;t load
        </h2>
        <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
          Something went wrong fetching it. Nothing you were working on has been lost —
          trying again usually fixes it.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={() => reset()}>
          <RotateCw aria-hidden="true" />
          Try again
        </Button>
        <Link href={backHref} className={cn(buttonVariants({ variant: "outline" }))}>
          <ArrowLeft aria-hidden="true" />
          {backLabel}
        </Link>
      </div>

      {error.digest ? (
        <p className="text-2xs text-muted-foreground">
          Reference <span className="font-mono tabular-nums">{error.digest}</span>
        </p>
      ) : null}
    </div>
  );
}
