"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/core/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/core/ui/card";
import { discardDraft, retryScribe } from "@/app/clinic/scribe/actions";

export type ScribeRun = {
  id: string;
  status: string;
  error: string | null;
  patientName: string;
};

/**
 * Scribe runs that are still going, or that failed (delta D-08).
 *
 * The async scribe's honest cost is that a failure is no longer something the doctor
 * sees happen — the request that started it is long gone. So the runs have to be ON
 * THE PAGE: an in-flight one so nobody re-records thinking nothing happened, and a
 * failed one because it holds a real recording of a real consultation and would
 * otherwise sit there unmentioned.
 *
 * It refreshes itself while anything is in flight, because the thing that finishes the
 * work is a background job with no way to tell this tab.
 */
export function ScribeRuns({ runs }: { runs: ScribeRun[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const inFlight = runs.some((r) => r.status === "transcribing");

  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [inFlight, router]);

  if (runs.length === 0) return null;

  function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    startTransition(async () => {
      await fn();
      router.refresh();
      setBusy(null);
    });
  }

  return (
    <Card className="border-warning/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-warning-text" aria-hidden="true" />
          Recordings being written up
        </CardTitle>
        <CardDescription>
          Your recording is saved as soon as you stop. Writing the note happens in the
          background, so you can close this page and come back.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {runs.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.patientName}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {r.status === "transcribing" ? "Writing the note…" : (r.error ?? "The scribe failed.")}
                </span>
              </span>
              {r.status === "transcribing" ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
              ) : (
                <span className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy === r.id}
                    onClick={() => act(r.id, () => retryScribe(r.id))}
                  >
                    <RotateCcw className="size-3.5" aria-hidden="true" />
                    Try again<span className="sr-only"> for {r.patientName}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy === r.id}
                    onClick={() => act(r.id, () => discardDraft(r.id))}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    <span className="sr-only">Discard {r.patientName}&apos;s recording</span>
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
