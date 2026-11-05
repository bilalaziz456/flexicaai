"use client";

import { DownloadPdfButton } from "@/core/ui/download-pdf-button";

/**
 * The P&L's one export-to-paper control: a PDF of the page's content area, A4.
 * The owner asked for Download PDF without a Print button here (2026-11-06). A client
 * wrapper only because `target` is a function, which cannot cross from the server page.
 */
export function PlDownloadPdf() {
  return <DownloadPdfButton target={() => document.querySelector("main")} />;
}
