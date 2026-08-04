"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Logo } from "@/core/ui/logo";
import { Button, buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";

/**
 * App-wide error boundary. Catches errors thrown while rendering any route segment
 * that has no closer boundary, and offers recovery — `reset()` re-renders the segment,
 * plus a way home (Nielsen #9). Client component (required by Next for error.tsx).
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the error for logging/observability (never shown raw to the user).
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-12 text-center">
      <Logo className="h-auto w-full max-w-[220px]" />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          An unexpected error occurred. You can try again, or head back to your dashboard.
        </p>
        {error.digest ? (
          <p className="text-xs text-muted-foreground">Reference: {error.digest}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={() => reset()}>Try again</Button>
        <Link href="/" className={cn(buttonVariants({ variant: "outline" }))}>
          Go to homepage
        </Link>
      </div>
    </main>
  );
}
