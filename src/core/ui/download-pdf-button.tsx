"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/core/ui/button";
import { toast } from "@/core/ui/toast";
import { downloadElementAsPdf, PDF_PAPER, pdfFailureReason, type PdfPaper } from "@/core/ui/download-pdf";

/**
 * "Download PDF" — saves what is on screen straight to a file, beside every Print
 * (owner's call, 2026-10-15). See `download-pdf.ts` for how the file is made.
 *
 * `target` is a FUNCTION so a caller can hand over a ref that only exists after the
 * first render. Marked `data-no-pdf`, like every screen control, so it never appears
 * in the file it makes.
 */
export function DownloadPdfButton({
  target,
  paper = PDF_PAPER.a4,
  includesMargin = false,
  label = "Download PDF",
  fileName,
}: {
  target: () => HTMLElement | null;
  paper?: PdfPaper;
  /** True when the element's own padding already is the page margin (the print sheet). */
  includesMargin?: boolean;
  label?: string;
  fileName?: string;
}) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const el = target();
    if (!el) return;
    setBusy(true);
    try {
      await downloadElementAsPdf(el, { paper, includesMargin, fileName });
    } catch (e) {
      console.error("PDF download failed", e);
      // A page with an image the browser refuses to draw (a broken logo, a cross-site
      // picture) is the usual cause. It happens in front of the person, who is told
      // and can still print — `report()` is server-only, and there is nothing to fix
      // server-side.
      toast.error(`Couldn't make the PDF (${pdfFailureReason(e)}). Use Print and choose “Save as PDF” instead.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button type="button" size="sm" variant="outline" onClick={run} disabled={busy} data-no-pdf="">
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
      {busy ? "Preparing…" : label}
    </Button>
  );
}
