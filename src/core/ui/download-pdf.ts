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

/**
 * Open out every scroll box inside `el` for the duration of the capture, and return
 * the function that puts them back.
 *
 * WHY: a picture of a scroll box is a picture of its scrollbars. The P&L's By-period
 * table sits in an `overflow-x-auto` wrapper (which makes the Y axis scrollable too —
 * CSS will not let one axis stay `visible`), and in the copy html-to-image draws, the
 * content came out a hair larger than the box: the PDF showed both scrollbars, the
 * Profit column cut off and the last rows missing (owner's report, 2026-11-06). Paper
 * has no scrolling, so the file must show everything the box holds. Done on the LIVE
 * element because html-to-image copies computed styles from it; the change lasts only
 * as long as the capture.
 */
function expandScrollAreas(el: HTMLElement): () => void {
  const changed: {
    node: HTMLElement;
    overflow: string;
    maxHeight: string;
    height: string;
    top: number;
    left: number;
  }[] = [];
  const scrolls = (v: string) => v === "auto" || v === "scroll";
  for (const node of [el, ...el.querySelectorAll<HTMLElement>("*")]) {
    const cs = getComputedStyle(node);
    if (!scrolls(cs.overflowX) && !scrolls(cs.overflowY)) continue;
    changed.push({
      node,
      overflow: node.style.overflow,
      maxHeight: node.style.maxHeight,
      height: node.style.height,
      // Opening a box out resets its scroll; the reader should not lose their place.
      top: node.scrollTop,
      left: node.scrollLeft,
    });
    node.style.overflow = "visible";
    node.style.maxHeight = "none";
    if (scrolls(cs.overflowY)) node.style.height = "auto";
  }
  return () => {
    for (const c of changed) {
      c.node.style.overflow = c.overflow;
      c.node.style.maxHeight = c.maxHeight;
      c.node.style.height = c.height;
      c.node.scrollTop = c.top;
      c.node.scrollLeft = c.left;
    }
  };
}

/**
 * Hide the screen controls on the LIVE page for the duration of the capture.
 *
 * WHY: `keep` already leaves them out of the drawn copy, but the page breaks below are
 * measured on the live page — and with the filter bar still in place there, every
 * measurement would sit that much lower than the same thing in the picture, putting
 * the breaks in the wrong place. Hiding them here makes the two layouts identical.
 * Only the outermost marked node is touched; its children go with it.
 */
function hideScreenControls(el: HTMLElement): () => void {
  const hidden: { node: HTMLElement; display: string }[] = [];
  for (const node of el.querySelectorAll<HTMLElement>(".no-print, [data-no-pdf]")) {
    if (node.parentElement?.closest(".no-print, [data-no-pdf]")) continue;
    hidden.push({ node, display: node.style.display });
    node.style.display = "none";
  }
  // And the reverse: paper-only lines (a report's period, globals.css) appear in the file.
  for (const node of el.querySelectorAll<HTMLElement>("[data-pdf-only]")) {
    hidden.push({ node, display: node.style.display });
    node.style.display = "block";
  }
  return () => {
    for (const h of hidden) h.node.style.display = h.display;
  };
}

/** Blocks a page break should not cut through, if they fit on a page at all. */
const KEEP_TOGETHER = '[data-slot="card"], [data-pdf-keep], tr, li, p, h1, h2, h3, h4, svg';

/**
 * The vertical extent of every keep-together block, in CSS px from the top of `el`.
 * Measured on the live page in the same state the capture sees.
 */
type Block = { top: number; bottom: number; rows: boolean };

function measureBlocks(el: HTMLElement): Block[] {
  const origin = el.getBoundingClientRect().top;
  const out: Block[] = [];
  for (const node of el.querySelectorAll<HTMLElement>(KEEP_TOGETHER)) {
    const r = node.getBoundingClientRect();
    if (r.height <= 0) continue;
    // A block made of rows (a table or list card) can continue on the next page
    // between two rows when it is big — see `pageBreak`.
    const rows = node.matches('[data-slot="card"], [data-pdf-keep]') && node.querySelector("tr, li") !== null;
    out.push({ top: r.top - origin, bottom: r.bottom - origin, rows });
  }
  return out;
}

/** A row-made block taller than this share of a page may be split between its rows. */
const SPLIT_ROWS_ABOVE = 0.5;

/**
 * Where to end the page that starts at `top`, given room for `sliceH`.
 *
 * WHY: the PDF is one tall picture cut into pages, and cutting at a fixed height went
 * straight through the P&L's "Expenses by category" and "Doctor shares" cards — half a
 * donut on one page, half on the next (owner's report, 2026-11-06). So the cut moves UP
 * to the top of any block it would split, provided that block fits on a page by itself
 * (a block taller than a page has to be split somewhere; then its rows, which are
 * blocks too, keep the cut between two rows). Repeated until nothing is split, since
 * moving up can land inside another block. Never moves back to `top`, or a page would
 * be empty and the loop would not advance.
 *
 * Except a BIG block made of rows (owner's report, 2026-11-10): the P&L's "By period"
 * table for Today — 24 hourly rows — fits on a page, so it was pushed whole to page 2
 * and left page 1 more than half blank. A table or list card taller than half a page
 * may therefore continue on the next page; its rows are blocks of their own, so the cut
 * still falls between two rows, never through one. Charts and small cards stay whole.
 */
function pageBreak(top: number, sliceH: number, fullH: number, blocks: Block[]): number {
  if (top + sliceH >= fullH) return fullH;
  let cut = top + sliceH;
  for (let moved = true; moved; ) {
    moved = false;
    for (const b of blocks) {
      const h = b.bottom - b.top;
      const fits = h <= sliceH && !(b.rows && h > sliceH * SPLIT_ROWS_ABOVE);
      if (fits && b.top > top && b.top < cut && b.bottom > cut) {
        cut = b.top;
        moved = true;
      }
    }
  }
  // Leave a little room so a cut exactly on a border does not shave a pixel off it.
  return cut > top + 1 ? cut : top + sliceH;
}

/** Make the PDF of an element: its bytes and the file name it should be saved as. */
export async function buildElementPdf(el: HTMLElement, opts: PdfOpts): Promise<{ bytes: Uint8Array; name: string }> {
  const { paper } = opts;
  // Twice the screen resolution: sharp enough to read small print once printed, and
  // still a few hundred KB a page as JPEG.
  // The on-screen sheet's border, rounding and shadow are screen decoration — paper
  // has none — so the copy that is drawn drops them (the original is untouched).
  const restoreControls = hideScreenControls(el);
  const restoreScroll = expandScrollAreas(el);
  let dataUrl: string;
  // Block positions in CSS px, and the element's width to convert them to the PDF's.
  let blocks: Block[] = [];
  let cssWidth = 1;
  try {
    blocks = measureBlocks(el);
    cssWidth = el.getBoundingClientRect().width || 1;
    dataUrl = await toJpeg(el, {
      pixelRatio: 2,
      quality: 0.92,
      backgroundColor: "#ffffff",
      filter: keep,
      cacheBust: true,
      style: { border: "none", borderRadius: "0", boxShadow: "none" },
    });
  } finally {
    restoreScroll();
    restoreControls();
  }
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
    // Block positions in the PDF's units (points), the same scale as the picture.
    const ptPerCss = contentW / cssWidth;
    const ptBlocks = blocks.map((b) => ({ ...b, top: b.top * ptPerCss, bottom: b.bottom * ptPerCss }));
    const white = { color: rgb(1, 1, 1) };
    // Each page shows the next band of the image, from `top` to the break chosen for
    // it; the band is placed so it starts at the top margin, and everything outside it
    // — the margins, and the next band showing below a short one — is painted white.
    for (let top = 0; top < fullH - 0.5; ) {
      const bottom = pageBreak(top, sliceH, fullH, ptBlocks);
      const page = pdf.addPage([pageW, pageH]);
      page.drawImage(jpg, { x: margin, y: pageH - margin - fullH + top, width: contentW, height: fullH });
      page.drawRectangle({ x: 0, y: pageH - margin, width: pageW, height: margin, ...white });
      page.drawRectangle({ x: 0, y: 0, width: pageW, height: pageH - margin - (bottom - top), ...white });
      top = bottom;
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
  // An invoice may already have opened the dialog before React started (EarlyPrint);
  // the flag also covers React's development double-run. One dialog, never two.
  const w = window as Window & { __flexicaPrintStarted?: boolean };
  if (w.__flexicaPrintStarted) return;
  w.__flexicaPrintStarted = true;
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
