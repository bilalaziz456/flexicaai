"use client";

import { Printer } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/core/ui/button";
import { inPdfMode, PDF_PAPER, printInFrame, printModePaper, sendPdfToParent } from "@/core/ui/download-pdf";
import { DownloadPdfButton } from "@/core/ui/download-pdf-button";

/**
 * Triggers the browser's print dialog, whose "Save as PDF" destination is how this
 * app produces PDFs — invoices, receipts, the doctor statement and the money reports
 * all print rather than pulling in a PDF library (CLAUDE.md §12: no new major
 * dependency without a reason).
 *
 * Lives in `core/ui` because three separate areas of the clinic workspace use it and
 * it knows nothing about any of them; it previously sat in the SHARES panel and was
 * imported from Reports, which dragged a shares module into an unrelated page graph
 * (conventions §6 — a route group is not a library).
 *
 * The page supplies the print CSS: hide the chrome and anything marked `.no-print`,
 * including this button.
 */
export function PrintButton({ label = "Print" }: { label?: string }) {
  // Loaded by a Download link: make the page's PDF and hand it back.
  useEffect(() => {
    if (inPdfMode()) void sendPdfToParent(() => document.querySelector("main"), { paper: PDF_PAPER.a4 });
    // Loaded by a Print button elsewhere: these pages print on A4 only.
    else if (printModePaper()) void printInFrame();
  }, []);
  // One group, so Print and Download stay side by side however the page lays out its
  // toolbar (a `justify-between` row would otherwise push them apart).
  return (
    <div className="inline-flex items-center gap-2" data-no-pdf="">
      <Button type="button" variant="outline" size="sm" onClick={() => window.print()} data-no-pdf="">
        <Printer className="size-4" aria-hidden="true" /> {label}
      </Button>
      {/* Every Print has a Download beside it (owner's call, 2026-10-15): the page's
          own content area, as an A4 PDF, minus anything marked as a screen control. */}
      <DownloadPdfButton target={() => document.querySelector("main")} />
    </div>
  );
}
