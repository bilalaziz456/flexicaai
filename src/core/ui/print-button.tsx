"use client";

import { Printer } from "lucide-react";
import { Button } from "@/core/ui/button";

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
export function PrintButton({ label = "Print / Save PDF" }: { label?: string }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden="true" /> {label}
    </Button>
  );
}
