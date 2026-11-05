"use client";

import { DownloadPdfButton } from "@/core/ui/download-pdf-button";

/**
 * "Download PDF" of the page you are looking at — every report has one (owner's call,
 * 2026-11-06). A PDF of the page's content area (`<main>`), A4, named by the page's
 * `PrintFileName`.
 *
 * Anything marked `.no-print` or `data-no-pdf` is left out — filter bars, header
 * buttons, a table's action column — so a page using this marks its screen controls.
 * Scroll boxes are opened out and pages break between cards and rows, not through
 * them (`download-pdf.ts`), so the file needs nothing else from the page.
 *
 * A client wrapper only because `target` is a function, which cannot cross from a
 * server page as a prop.
 */
export function PageDownloadPdf({ label }: { label?: string }) {
  return <DownloadPdfButton label={label} target={() => document.querySelector("main")} />;
}
