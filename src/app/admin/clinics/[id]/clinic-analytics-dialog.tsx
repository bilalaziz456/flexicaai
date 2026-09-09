"use client";

import { useState, useTransition } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { BarChart3, Printer, X } from "lucide-react";
import type { ClinicAnalytics } from "@/core/admin/clinic-analytics";
import { Button } from "@/core/ui/button";
import { loadClinicAnalytics } from "@/app/admin/actions";
import { ClinicAnalyticsCard } from "./clinic-analytics-card";

/**
 * "Clinic analytics" — the scorecard, in a modal, printable.
 *
 * LOADED ON OPEN, not with the page. The card runs about a dozen aggregates across the
 * clinic's whole history; paying for that on every visit to the clinic page, when most
 * visits are to change a setting, would slow the page for everyone to serve the few
 * who open this.
 *
 * Fetched ONCE per open and cached in state — reopening is instant, and the numbers
 * cannot shift under the reader mid-read. Reopening after a change gets fresh data
 * because the dialog unmounts nothing but keeps the last result until asked again.
 *
 * Built on Base UI `Dialog` like `ConfirmDialog`, so focus is trapped and restored,
 * Escape and backdrop dismiss, and background scroll locks — none of which a
 * hand-rolled portal gets right.
 */
export function ClinicAnalyticsDialog({ clinicId }: { clinicId: string }) {
  const [data, setData] = useState<ClinicAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // The PAYER half re-scopes instantly inside the card — its months are already on the
  // client. Only the BUSINESS half needs the server, since counting appointments over a
  // new window is a query. The fetch therefore runs in the background and the card dims
  // the old figures rather than blanking them: a number that vanishes on every click is
  // harder to read than one that is briefly stale.
  function load(months: number | null) {
    start(async () => {
      const res = await loadClinicAnalytics(clinicId, months);
      if ("error" in res) setError(res.error);
      else setData(res.data);
    });
  }

  function onOpenChange(next: boolean) {
    if (!next || data || pending) return;
    load(3);
  }

  // Print only the sheet. Without this the browser prints the whole admin page behind
  // the modal — which is how the reference report was produced, so it has to work.
  // PRINT. The obvious `visibility: hidden` trick produced a TEN-page PDF for a
  // two-page card: hidden content still takes part in layout, so the whole admin page
  // behind the modal contributed its height as blank sheets. Everything here exists to
  // fix a specific way the on-screen modal misbehaves on paper.
  const css = `@media print {
  @page { size: A4 portrait; margin: 12mm; }
  html, body { height: auto !important; overflow: visible !important; }

  /* DISPLAY:NONE, not visibility — only the branch holding the sheet may occupy
     layout, or the page count is driven by the admin page underneath. */
  body > *:not(:has(.analytics-sheet)) { display: none !important; }
  [data-analytics-backdrop] { display: none !important; }

  /* The popup is fixed, centred and height-capped for the screen. On paper it has to
     become an ordinary block, or only the slice that happened to be visible prints. */
  [data-analytics-popup] {
    position: static !important;
    transform: none !important;
    translate: none !important;
    rotate: none !important;
    scale: none !important;
    inset: auto !important;
    max-height: none !important;
    width: auto !important;
    box-shadow: none !important;
    border-radius: 0 !important;
    --tw-ring-shadow: 0 0 #0000 !important;
  }
  [data-analytics-scroll] { overflow: visible !important; max-height: none !important; padding: 0 !important; }
  /* The history table has its own inner scroll; unclipped it prints every month. */
  .analytics-scroll { overflow: visible !important; max-height: none !important; }

  .no-print { display: none !important; }

  /* Browsers drop background colours by default, which would leave the grade band's
     white text on white paper and the donut arcs blank. */
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }

  /* Do not split a chart or a donut across a page break. */
  .analytics-sheet > *, .analytics-sheet section { break-inside: avoid; }
  table { break-inside: auto; }
  tr { break-inside: avoid; }
}`;

  return (
    <Dialog.Root onOpenChange={onOpenChange}>
      <Dialog.Trigger
        render={
          <Button variant="outline" size="sm">
            <BarChart3 className="size-4" /> Clinic analytics
          </Button>
        }
      />
      <Dialog.Portal>
        <Dialog.Backdrop data-analytics-backdrop className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Popup data-analytics-popup className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[min(60rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl bg-card shadow-lg ring-1 ring-foreground/10">
          <style dangerouslySetInnerHTML={{ __html: css }} />

          <div className="no-print flex items-center justify-between gap-3 border-b px-4 py-3">
            <Dialog.Title className="font-heading text-base font-semibold">
              Clinic analytics
            </Dialog.Title>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!data}>
                <Printer className="size-4" /> Print
              </Button>
              <Dialog.Close
                render={
                  <Button variant="ghost" size="sm" aria-label="Close">
                    <X className="size-4" />
                  </Button>
                }
              />
            </div>
          </div>

          <div data-analytics-scroll className="min-h-0 flex-1 overflow-y-auto p-4">
            {pending && !data ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
            ) : error ? (
              <p className="py-10 text-center text-sm text-destructive">{error}</p>
            ) : data ? (
              <ClinicAnalyticsCard data={data} onPeriodChange={load} refreshing={pending} />
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">No data.</p>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
