"use client";

import { useState, useTransition } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { BarChart3, Printer, X } from "lucide-react";
import type { ClinicAnalytics } from "@/core/admin/clinic-analytics";
import { EmptyState } from "@/core/ui/empty-state";
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
    border: 0 !important;
    border-radius: 0 !important;
    --tw-ring-shadow: 0 0 #0000 !important;
    /* On SCREEN the popup is the tinted ground the cards sit on. Paper already is
       that ground, and \`print-color-adjust: exact\` below would otherwise lay the
       tint down as ink across every sheet. */
    background: transparent !important;
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
          <Button variant="outline">
            {/* No explicit size: it sits in a row with Import and Export, and the
                Button already sizes its own icon. */}
            <BarChart3 aria-hidden="true" />
            Clinic analytics
          </Button>
        }
      />
      <Dialog.Portal>
        {/* NOT migrated to `core/ui/dialog`, deliberately. This one is a PRINT surface:
            `data-analytics-backdrop` / `data-analytics-popup` are hooks the print CSS
            targets to turn the modal into a page, and it carries its own header, its own
            width and its own scroll region. Wrapping it would mean re-exposing all of
            that through the shared component for a single caller, and the thing at risk
            is what comes out of a printer. */}
        {/* The same scrim as every other dialog: diffused rather than a flat black
            sheet, so the page reads as still there but not in focus. */}
        <Dialog.Backdrop
          data-analytics-backdrop
          className="fixed inset-0 z-50 bg-[hsl(var(--shadow-color)/0.45)] backdrop-blur-[3px]"
        />
        {/* `data-slot` is what puts this popup INTO the surface ladder (globals.css):
            without it the panels inside resolved to the popup's own colour and drew as
            borders with no fill. `data-analytics-popup` stays — it is the print hook. */}
        <Dialog.Popup
          data-analytics-popup
          data-slot="dialog-popup"
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[min(60rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border/70 bg-background elev-4"
        >
          <style dangerouslySetInnerHTML={{ __html: css }} />

          {/* The header keeps the card surface so it reads as chrome over the
              document below it, the way the panel header sits over the page. */}
          <div className="no-print flex items-center justify-between gap-3 border-b border-border/70 bg-card px-4 py-3">
            <Dialog.Title className="font-display text-base font-semibold tracking-[-0.015em]">
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
              <EmptyState
                icon={BarChart3}
                title="Nothing to analyse yet"
                description="This clinic has no activity in the selected period. Try a wider one."
              />
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
