"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";
import { BRAND_POWERED_BY } from "@/core/lib/brand";

/** Paper formats: browser `@page` size + on-screen sheet width/scale. */
const FORMATS = {
  thermal: { label: "Thermal", page: "80mm auto", margin: "3mm", width: "80mm", font: "11px" },
  a5: { label: "A5", page: "A5", margin: "10mm", width: "148mm", font: "12px" },
  a4: { label: "A4", page: "A4", margin: "14mm", width: "210mm", font: "13px" },
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
  children,
}: {
  defaultFormat?: string;
  children: React.ReactNode;
}) {
  const [fmt, setFmt] = useState<Fmt>(
    defaultFormat in FORMATS ? (defaultFormat as Fmt) : "a4",
  );
  const f = FORMATS[fmt];
  const css = `@media print {
  @page { size: ${f.page}; margin: ${f.margin}; }
  aside, header { display: none !important; }
  main { padding: 0 !important; max-width: none !important; }
  .no-print { display: none !important; }
  .invoice-sheet { width: auto !important; border: 0 !important; box-shadow: none !important; padding: 0 !important; }
}`;

  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Format</span>
        {(Object.keys(FORMATS) as Fmt[]).map((k) => (
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
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden="true" /> Print / Save PDF
        </Button>
      </div>

      <div
        className="invoice-sheet mx-auto rounded-md border bg-white p-5 text-black shadow-sm"
        style={{ width: `min(100%, ${f.width})`, fontSize: f.font }}
      >
        {children}
        {/* Brand credit — printed at the foot of every document that uses this frame. */}
        <div className="mt-4 border-t border-black/10 pt-2 text-center text-[0.7em] opacity-60">
          {BRAND_POWERED_BY}
        </div>
      </div>
    </div>
  );
}
