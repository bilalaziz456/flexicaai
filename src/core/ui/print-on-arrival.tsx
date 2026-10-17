"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { printDocument } from "@/core/ui/print-links";
import { AUTO_PRINT_ID_PARAM, AUTO_PRINT_PARAM } from "@/core/lib/print-papers";

const PAPERS = ["thermal", "a5", "a4"];
const PRINTED_KEY = "flexica-printed";

/** Has this one save-and-print request already printed? (per browser tab) */
function alreadyPrinted(id: string): boolean {
  try {
    const seen: unknown = JSON.parse(sessionStorage.getItem(PRINTED_KEY) ?? "[]");
    return Array.isArray(seen) && seen.includes(id);
  } catch {
    return false;
  }
}
function markPrinted(id: string): void {
  try {
    const seen: unknown = JSON.parse(sessionStorage.getItem(PRINTED_KEY) ?? "[]");
    // The last few are enough: an id only has to outlive the visits back to its page.
    const list = Array.isArray(seen) ? seen.filter((v): v is string => typeof v === "string").slice(-49) : [];
    sessionStorage.setItem(PRINTED_KEY, JSON.stringify([...list, id]));
  } catch {
    // Storage blocked: the cleaned address below still stops most repeats.
  }
}

/**
 * Prints a document ONCE on arrival — the second half of a "Save & print A4" button
 * whose save is a Server Action that redirects (owner's call, 2026-10-18). The action
 * cannot print, and the page it lands on can: so the size rides along as
 * `?printPaper=a4&printId=<one-time id>` and this prints `href` at it, in the same
 * hidden frame as every Print button.
 *
 * ONCE is held two ways, because the first alone was not enough (owner's report,
 * 2026-10-18 — the invoice printed again on returning to it from another screen):
 * - the request's id is remembered for the tab, and an id never prints twice, however
 *   the page is reached again (the app's tabs, Back, the router's cache of the page);
 * - the parameters are dropped through the ROUTER, not `history.replaceState`, which
 *   left the app's own record of the page still carrying the old address.
 */
export function PrintOnArrival({
  href,
  paper,
  printId,
}: {
  href: string;
  paper: string | null | undefined;
  printId: string | null | undefined;
}) {
  const router = useRouter();
  const done = useRef(false);
  useEffect(() => {
    // `done` guards React's development double-run: one print, not two.
    if (done.current || !paper || !PAPERS.includes(paper) || !printId) return;
    done.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete(AUTO_PRINT_PARAM);
    url.searchParams.delete(AUTO_PRINT_ID_PARAM);
    router.replace(url.pathname + url.search + url.hash, { scroll: false });
    if (alreadyPrinted(printId)) return;
    markPrinted(printId);
    printDocument(href, paper);
  }, [href, paper, printId, router]);
  return null;
}
