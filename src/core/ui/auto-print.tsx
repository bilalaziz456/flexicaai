"use client";

import { useEffect } from "react";

/**
 * Opens the print dialog once the page has painted — for a page whose only purpose
 * is to be printed, so the click that opened it is the click that prints it.
 *
 * A timeout rather than a bare call: the dialog snapshots the page, and calling it
 * during the first commit can catch fonts that have not finished loading. The
 * cleanup cancels it, so React's development double-mount opens one dialog, not two.
 */
export function AutoPrint() {
  useEffect(() => {
    const timer = setTimeout(() => window.print(), 300);
    return () => clearTimeout(timer);
  }, []);
  return null;
}
