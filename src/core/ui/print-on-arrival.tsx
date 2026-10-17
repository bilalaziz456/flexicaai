"use client";

import { useEffect, useRef } from "react";
import { printDocument } from "@/core/ui/print-links";
import { AUTO_PRINT_PARAM } from "@/core/lib/print-papers";

const PAPERS = ["thermal", "a5", "a4"];

/**
 * Prints a document ONCE on arrival — the second half of a "Save & print A4" button
 * whose save is a Server Action that redirects (owner's call, 2026-10-18). The action
 * cannot print, and the page it lands on can: so the size rides along as
 * \`?printPaper=a4\` and this prints \`href\` at it, in the same hidden frame as every
 * Print button. The parameter is then dropped from the address, so a refresh or the
 * Back button does not print again.
 */
export function PrintOnArrival({ href, paper }: { href: string; paper: string | null | undefined }) {
  const done = useRef(false);
  useEffect(() => {
    // `done` guards React's development double-run: one print, not two.
    if (done.current || !paper || !PAPERS.includes(paper)) return;
    done.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete(AUTO_PRINT_PARAM);
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    printDocument(href, paper);
  }, [href, paper]);
  return null;
}
