"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, RotateCw } from "lucide-react";
import { Logo } from "@/core/ui/logo";
import { Button, buttonVariants } from "@/core/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/ui/card";
import { cn } from "@/core/lib/utils";

/**
 * App-wide error boundary — the LAST resort before `global-error`. /clinic and /admin
 * each have their own now (`ErrorState`, which fails inside the content area and keeps
 * the workspace chrome), so what actually lands here is the handful of screens with no
 * panel around them: the marketing site, the credentials screens, /account and /paused.
 *
 * Those all render outside a PanelShell, so this one is a standalone screen and takes
 * the same treatment as its neighbours — `app-root` for the type system, the brand
 * wash, and the card the auth screens use. `reset()` re-renders the segment; the home
 * link is the way out when it doesn't (Nielsen #9).
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaced for logging/observability; never rendered raw to the user.
    console.error(error);
  }, [error]);

  return (
    <main className="app-root relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      {/* The same quiet wash as the credentials screens. Static, aria-hidden, and well
          under 10% opacity — depth behind the card, never decoration competing with a
          message someone is trying to read. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 left-1/2 size-[34rem] -translate-x-1/2 rounded-full bg-[var(--brand-teal)] opacity-[0.06] blur-[110px]" />
        <div className="absolute -bottom-40 right-[12%] size-[28rem] rounded-full bg-[var(--brand-navy)] opacity-[0.05] blur-[120px]" />
      </div>

      <div className="w-full max-w-[25rem]">
        <div className="mb-7 flex justify-center">
          <Logo className="h-auto w-full max-w-[220px]" />
        </div>

        <Card className="p-1.5" role="alert">
          <CardHeader>
            <div className="mb-1 flex size-11 items-center justify-center rounded-full border border-dashed border-warning/40 bg-warning/[0.08] text-warning-text">
              <AlertTriangle className="size-5" aria-hidden="true" />
            </div>
            <CardTitle className="text-xl">Something went wrong</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              An unexpected error stopped this page from loading. Nothing you were
              working on has been lost — trying again usually fixes it.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => reset()}>
                <RotateCw aria-hidden="true" />
                Try again
              </Button>
              <Link href="/" className={cn(buttonVariants({ variant: "outline" }))}>
                <ArrowLeft aria-hidden="true" />
                Go home
              </Link>
            </div>

            {/* A reference, never a stack trace: it is the one thing that makes a
                support conversation about a specific failure possible. */}
            {error.digest ? (
              <p className="text-2xs text-muted-foreground">
                Reference <span className="font-mono tabular-nums">{error.digest}</span>
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
