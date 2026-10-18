"use client";

import { toJpeg } from "html-to-image";
import { PDFDocument, rgb } from "pdf-lib";
import { currentPrintFileName } from "@/core/ui/print-file-name";

/**
 * A one-click PDF of what is on screen — the Download beside every Print (owner's
 * call, 2026-10-15). Before this the only way to a file was the print dialog's "Save
 * as PDF", which most front-desk staff never find.
 *
 * Built in the BROWSER from the very element that prints, so the PDF cannot drift
 * from the printout and the server does no work. `html-to-image` rather than
 * `html2canvas`: the browser draws the page itself (an SVG foreignObject), so the
 * app's oklch colours and web fonts come out right, which html2canvas cannot parse.
 * The trade-off, chosen knowingly: each page is a picture, so its text is not
 * selectable. pdf-lib (already used for prescriptions) assembles the pages.
 */

/** Paper sizes in millimetres. `height: null` = one continuous strip (a thermal roll). */
export type PdfPaper = { widthMm: number; heightMm: number | null; marginMm: number };
export const PDF_PAPER = {
  a4: { widthMm: 210, heightMm: 297, marginMm: 14 },
  a5: { widthMm: 148, heightMm: 210, marginMm: 10 },
  thermal: { widthMm: 80, heightMm: null, marginMm: 3 },
} as const satisfies Record<string, PdfPaper>;

const PT_PER_MM = 72 / 25.4;

/** Anything marked as a screen control stays out of the file, exactly as it stays off paper. */
function keep(node: HTMLElement): boolean {
  if (!(node instanceof HTMLElement)) return true;
  return !node.classList.contains("no-print") && !node.hasAttribute("data-no-pdf");
}

type PdfOpts = { paper: PdfPaper; fileName?: string; includesMargin?: boolean };

/** Make the PDF of an element: its bytes and the file name it should be saved as. */
export async function buildElementPdf(el: HTMLElement, opts: PdfOpts): Promise<{ bytes: Uint8Array; name: string }> {
  const { paper } = opts;
  // Twice the screen resolution: sharp enough to read small print once printed, and
  // still a few hundred KB a page as JPEG.
  // The on-screen sheet's border, rounding and shadow are screen decoration — paper
  // has none — so the copy that is drawn drops them (the original is untouched).
  const dataUrl = await toJpeg(el, {
    pixelRatio: 2,
    quality: 0.92,
    backgroundColor: "#ffffff",
    filter: keep,
    cacheBust: true,
    style: { border: "none", borderRadius: "0", boxShadow: "none" },
  });
  const pdf = await PDFDocument.create();
  // The data URI goes to pdf-lib AS IS. Reading it back with `fetch(dataUrl)` was the
  // obvious move and broke every download: the panels' CSP allows `connect-src 'self'`
  // only, and a `data:` URL is not 'self', so the fetch was refused (owner's report).
  const jpg = await pdf.embedJpg(dataUrl);

  // When the element already carries the page margin as padding (the print sheet),
  // it fills the page edge to edge; otherwise the PDF adds the margin around it.
  const margin = opts.includesMargin ? 0 : paper.marginMm * PT_PER_MM;
  const pageW = paper.widthMm * PT_PER_MM;
  const contentW = pageW - margin * 2;
  const scale = contentW / jpg.width;
  const fullH = jpg.height * scale;

  if (paper.heightMm === null) {
    // A receipt roll is one long page — never cut a thermal slip in two.
    const page = pdf.addPage([pageW, fullH + margin * 2]);
    page.drawImage(jpg, { x: margin, y: margin, width: contentW, height: fullH });
  } else {
    const pageH = paper.heightMm * PT_PER_MM;
    const sliceH = pageH - margin * 2;
    // Each page shows the next band of the image; the band is placed so only it falls
    // inside the page, and the margin is painted white over any overflow.
    for (let top = 0; top < fullH; top += sliceH) {
      const page = pdf.addPage([pageW, pageH]);
      page.drawImage(jpg, { x: margin, y: pageH - margin - fullH + top, width: contentW, height: fullH });
      if (margin > 0) {
        const white = { color: rgb(1, 1, 1) };
        page.drawRectangle({ x: 0, y: pageH - margin, width: pageW, height: margin, ...white });
        page.drawRectangle({ x: 0, y: 0, width: pageW, height: margin, ...white });
      }
    }
  }

  const bytes = await pdf.save();
  const raw = opts.fileName ?? currentPrintFileName() ?? "Document";
  return { bytes, name: raw.toLowerCase().endsWith(".pdf") ? raw : `${raw}.pdf` };
}

/** Hand bytes to the browser as a download. */
export function savePdf(bytes: Uint8Array, name: string): void {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before the URL is released.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Make the PDF of an element and save it — the Download PDF button. */
export async function downloadElementAsPdf(el: HTMLElement, opts: PdfOpts): Promise<void> {
  const { bytes, name } = await buildElementPdf(el, opts);
  savePdf(bytes, name);
}

// ─── Download straight from a "Print …" link, without opening the page ────────

/** The query flag that tells a print page it is being loaded only to make its PDF. */
export const PDF_MODE_PARAM = "pdf";

/** Is this page loaded in the hidden frame of a Download link? (Browser only.) */
export function inPdfMode(): boolean {
  if (typeof window === "undefined") return false;
  return window.self !== window.top && new URLSearchParams(window.location.search).get(PDF_MODE_PARAM) === "1";
}

/** What the hidden page sends back to the page holding the link. */
export type PdfMessage =
  | { type: "flexica-pdf"; ok: true; bytes: Uint8Array; name: string }
  | { type: "flexica-pdf"; ok: false; reason: string };

/** A short, readable reason for a failed PDF, shown to the person so it can be reported. */
export function pdfFailureReason(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return (msg || "unknown error").slice(0, 120);
}

/**
 * In the hidden frame: make the PDF once the page has fully painted (fonts and the
 * logo included), then hand the bytes to the parent page, which saves them. The
 * parent saves rather than the frame because some browsers refuse a download that
 * starts inside a hidden frame.
 */
export async function sendPdfToParent(target: () => HTMLElement | null, opts: PdfOpts): Promise<void> {
  try {
    await document.fonts?.ready;
    await new Promise((r) => setTimeout(r, 300));
    const el = target();
    if (!el) throw new Error("nothing to draw");
    const { bytes, name } = await buildElementPdf(el, opts);
    const msg: PdfMessage = { type: "flexica-pdf", ok: true, bytes, name };
    window.parent.postMessage(msg, window.location.origin);
  } catch (e) {
    console.error("PDF download failed", e);
    const msg: PdfMessage = { type: "flexica-pdf", ok: false, reason: pdfFailureReason(e) };
    window.parent.postMessage(msg, window.location.origin);
  }
}

// ─── Print straight from a list or a record, without opening the print page ────

/** The query flag that tells a print page to print itself at this paper size. */
export const PRINT_MODE_PARAM = "print";

/** In a Print button's hidden frame: the paper to print at (browser only), else null. */
export function printModePaper(): string | null {
  if (typeof window === "undefined" || window.self === window.top) return null;
  return new URLSearchParams(window.location.search).get(PRINT_MODE_PARAM);
}

/** What the hidden page tells the page holding the Print button. */
export type PrintMessage = { type: "flexica-print"; stage: "opened" | "done" };

/**
 * In the hidden frame: open the print dialog for this page once it has painted, and
 * tell the parent when the dialog opened and when it closed, so the parent can drop
 * the frame. The dialog is the browser's own — no website may print without it.
 */
export async function printInFrame(): Promise<void> {
  const tell = (stage: PrintMessage["stage"]) => {
    const msg: PrintMessage = { type: "flexica-print", stage };
    window.parent.postMessage(msg, window.location.origin);
  };
  await document.fonts?.ready;
  // A beat for the sheet to settle in its fonts — printing lays the page out afresh, so
  // it need not be long (was 300ms, a large share of a Save & print's wait). NOT
  // requestAnimationFrame: Chrome throttles it in this invisible frame to ~1.5s
  // (measured 2026-10-18).
  await new Promise((r) => setTimeout(r, 50));
  window.addEventListener("afterprint", () => tell("done"), { once: true });
  tell("opened");
  window.print();
}
