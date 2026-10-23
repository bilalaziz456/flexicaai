"use client";

import { PrintFileName } from "@/core/ui/print-file-name";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DownloadPdfButton } from "@/core/ui/download-pdf-button";
import { inPdfMode, PDF_PAPER, printInFrame, printModePaper, sendPdfToParent } from "@/core/ui/download-pdf";
import { Printer } from "lucide-react";
import { Button } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";
import { BRAND_POWERED_BY } from "@/core/lib/brand";

/** The URL never changes while a print page is open, so there is nothing to subscribe to. */
const noSubscribe = () => () => {};

/** Paper formats: browser `@page` size + on-screen sheet width/scale + logo height. */
const FORMATS = {
  // Thermal names NO page size (`page: null`, owner's report 2026-10-24). Any size we
  // name, Chrome CENTRES on the receipt printer's own paper — a POS-80 driver defaults
  // to an 80 x 3276 mm roll, so the receipt printed in the middle of three metres of
  // blank paper. Without a size the receipt starts at the top of whatever paper the
  // printer has, fills its printable width (58 mm or 80 mm rolls alike), and the
  // printer stops feeding where the content ends. The cost, accepted: "Print thermal"
  // to an A4 printer or Save as PDF gives a strip at the top of an A4 page; Download
  // still makes a proper receipt-sized PDF.
  thermal: { label: "Thermal", page: null, margin: "2mm", width: "80mm", font: "11px", logoH: "40px" },
  a5: { label: "A5", page: "A5", margin: "10mm", width: "148mm", font: "12px", logoH: "52px" },
  a4: { label: "A4", page: "A4", margin: "14mm", width: "210mm", font: "13px", logoH: "64px" },
} as const;
type Fmt = keyof typeof FORMATS;

/**
 * Print frame for a document (invoice/receipt) — a Thermal / A5 / A4 selector, a
 * Print/Save-PDF button, and per-format print CSS (`@page size`, chrome hidden).
 * The document JSX is passed as children (server-rendered) and shown on a white
 * "paper" sheet sized to the chosen format. Save-as-PDF is the browser's print path.
 */
export function InvoicePrintFrame({
  defaultFormat = "a4",
  allowed,
  logo = null,
  fileName,
  children,
}: {
  defaultFormat?: string;
  /**
   * The sizes this clinic actually uses (`clinics.invoice_papers_enabled`). Omitted
   * means all of them, which is what the admin-side print screens want — FlexicaAI's
   * own subscription invoices are not a clinic's document and are not governed by a
   * clinic's printer.
   */
  allowed?: readonly string[];
  /** Clinic logo as a `data:` URI (server-inlined). Printed in B&W at the top; null = none. */
  logo?: string | null;
  /** What a saved PDF is called, before the date and time ("Invoice INV-…"). */
  fileName?: string;
  children: React.ReactNode;
}) {
  const all = Object.keys(FORMATS) as Fmt[];
  // An unknown or empty list falls back to everything rather than to nothing: a
  // misconfigured clinic should still be able to print.
  const offered = (() => {
    const picked = all.filter((k) => allowed?.includes(k));
    return picked.length > 0 ? picked : all;
  })();
  const [fmt, setFmt] = useState<Fmt>(() => {
    const wanted = defaultFormat as Fmt;
    return offered.includes(wanted) ? wanted : offered[0];
  });
  // The size a "Print A4 / Print thermal" button asked for (`?print=`), read as an
  // external value rather than copied into state: the server renders without it, the
  // browser re-renders with it, and nothing is set inside an effect.
  const printParam = useSyncExternalStore(noSubscribe, printModePaper, () => null);
  const printPaper = printParam && offered.includes(printParam as Fmt) ? (printParam as Fmt) : null;
  const f = FORMATS[printPaper ?? (offered.includes(fmt) ? fmt : offered[0])];
  const sheetRef = useRef<HTMLDivElement>(null);
  // Loaded by a Download link: make this sheet's PDF at the opening paper size and
  // hand it back. Runs once; the page is thrown away afterwards.
  const paperKey = offered.includes(fmt) ? fmt : offered[0];
  useEffect(() => {
    if (!inPdfMode()) return;
    void sendPdfToParent(() => sheetRef.current, { paper: PDF_PAPER[paperKey], includesMargin: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, at the size the page opened at
  }, []);

  // Loaded by a "Print A4 / Print thermal" button: open the print dialog. The size it
  // asked for is already the one drawn (`printPaper` above), so the @page rule matches.
  const printed = useRef(false);
  useEffect(() => {
    // `printed` guards React's development double-run: one dialog, not two.
    if (!printPaper || printed.current) return;
    printed.current = true;
    void printInFrame();
  }, [printPaper]);
  const css = `@media print {
  @page { ${f.page ? `size: ${f.page}; ` : ""}margin: ${f.margin}; }
  /* The app's own chrome only — never a header or aside INSIDE the document, which a
     bare "header" selector hid (the invoice lost its clinic name and number, 2026-10-18). */
  aside:not(.invoice-sheet *), header:not(.invoice-sheet *) { display: none !important; }
  main { padding: 0 !important; max-width: none !important; }
  .no-print { display: none !important; }
  .invoice-sheet { width: auto !important; border: 0 !important; box-shadow: none !important; padding: 0 !important; }
  /* Filled bars and stamps print as drawn — browsers drop backgrounds by default. */
  .invoice-sheet, .invoice-sheet * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
/* THERMAL: solid black and heavier type (owner's call, 2026-10-22). A thermal head
   prints dots or nothing — there is no grey — so the soft labels (55–65% opacity) and
   15% dividers that read well on A4 came out faint or not at all. Not inside @media
   print, so the on-screen preview and the downloaded PDF show what the paper will. */
.invoice-sheet[data-paper="thermal"] { font-weight: 600; }
.invoice-sheet[data-paper="thermal"] * {
  opacity: 1 !important;
  color: #000 !important;
  border-color: #000 !important;
}
.invoice-sheet[data-paper="thermal"] :is(.font-medium, .font-semibold, .font-bold, b, strong, th, h1, h2, h3) {
  font-weight: 800 !important;
}
/* …except text on a black fill (the Total bar), which stays white. */
.invoice-sheet[data-paper="thermal"] :is(.bg-black, .bg-black *) { color: #fff !important; }`;

  return (
    <div>
      {fileName ? <PrintFileName name={fileName} /> : null}
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        {offered.length > 1 ? (
          <>
            <span className="text-xs text-muted-foreground">Format</span>
            {offered.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={fmt === k}
                onClick={() => setFmt(k)}
                className={cn(
                  "rounded-lg border px-3 py-1 text-sm transition-colors",
                  fmt === k ? "border-primary bg-primary/10" : "hover:bg-accent",
                )}
              >
                {FORMATS[k].label}
              </button>
            ))}
          </>
        ) : null}
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden="true" /> Print
        </Button>
        {/* Straight to a file, at the paper size picked above (owner's call). */}
        <DownloadPdfButton
          target={() => sheetRef.current}
          paper={PDF_PAPER[offered.includes(fmt) ? fmt : offered[0]]}
          includesMargin
        />
      </div>

      <div
        ref={sheetRef}
        // The paper it is drawn for, so a document can lay itself out per size —
        // `group-data-[paper=thermal]/sheet:…` (an 80mm receipt stacks what A4 spreads).
        data-paper={printPaper ?? paperKey}
        className="invoice-sheet group/sheet mx-auto rounded-md border bg-white text-black shadow-sm"
        style={{
          width: `min(100%, ${f.width})`,
          // The sheet's padding IS the page margin. A flat 20px made the preview
          // narrower than the real page on thermal (3mm) and wider on A4 (14mm), so
          // content that fits the paper could wrap differently on screen — which is
          // the one thing a print preview must not do.
          padding: f.margin,
          fontSize: f.font,
        }}
      >
        {/* Clinic logo — always black & white; sized to the paper format. */}
        {logo ? (
          <div className="mb-2 flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logo}
              alt=""
              className="object-contain"
              style={{
                maxHeight: f.logoH,
                maxWidth: "70%",
                // Print the logo AS UPLOADED — the printer handles B&W conversion
                // (thermal/mono renders it black & white with proper dithering; a
                // colour printer keeps colour). Forcing a CSS filter either muddies
                // it (grayscale) or destroys detail (brightness 0).
                WebkitPrintColorAdjust: "exact",
                printColorAdjust: "exact",
              }}
            />
          </div>
        ) : null}
        {children}
        {/* Brand credit — printed at the foot of every document that uses this frame. */}
        <div className="mt-4 border-t border-black/10 pt-2 text-center text-[0.7em] opacity-60">
          {BRAND_POWERED_BY}
        </div>
      </div>
    </div>
  );
}
