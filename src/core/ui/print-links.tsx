"use client";

import { useState } from "react";
import { Loader2, Printer } from "lucide-react";
import { toast } from "@/core/ui/toast";
import { cn } from "@/core/lib/utils";
import { PRINT_MODE_PARAM, type PrintMessage } from "@/core/ui/download-pdf";
import { PRINT_PAPERS as PAPERS } from "@/core/lib/print-papers";

/**
 * One Print button per paper size the clinic uses — "Print A4", "Print thermal" — that
 * prints the document WITHOUT opening its print page (owner's call, 2026-10-15).
 *
 * The browser's print dialog still opens: no website can print silently or choose a
 * printer, and Chrome remembers the last printer used. What this saves is the trip to
 * the print page and picking the size there. For a desk that should skip the dialog
 * too, see docs/front-desk-printing.md (Chrome's kiosk printing).
 *
 * Mechanism: the print page loads in an invisible same-origin frame with
 * `?print=<size>`; the page sets that size and opens the dialog for itself, then says
 * when it closed so the frame can go. Same framing rules as `DownloadLink`.
 */
export function PrintLinks({
  href,
  papers,
  className,
  single = "Print",
}: {
  /** The print page, exactly as its own link opens it. */
  href: string;
  /** Paper keys to offer (from `offeredPapers`). One → a plain "Print" button. */
  papers: readonly string[];
  className?: string;
  /** The label when only one size is offered. */
  single?: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const run = (paper: string) => {
    if (busy) return;
    setBusy(paper);
    printDocument(href, paper, {
      onOpened: () => setBusy(null),
      onDone: () => setBusy(null),
    });
  };

  const list = PAPERS.filter((p) => papers.includes(p.key));
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {list.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => run(p.key)}
          disabled={busy !== null}
          title={`Print on ${p.label} paper`}
          className={cn(
            "inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium underline-offset-4 hover:underline disabled:opacity-60",
            className,
          )}
        >
          {busy === p.key ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Printer className="size-4" aria-hidden="true" />
          )}
          {list.length === 1 ? single : `Print ${p.label}`}
        </button>
      ))}
    </span>
  );
}

/**
 * Print a document page at one paper size WITHOUT opening it — the mechanism behind
 * every Print button, exported so a form can save and then print ("Save & print A4").
 *
 * The print page loads in an invisible same-origin frame with `?print=<size>`; the page
 * sets that size and opens the dialog for itself, then says when it closed so the frame
 * can go. The frame belongs to the document, not to the caller, so it outlives a form
 * that re-renders or closes after saving. Same framing rules as `DownloadLink`.
 */
export function printDocument(
  href: string,
  paper: string,
  on: { onOpened?: () => void; onDone?: () => void } = {},
): void {
  const frame = document.createElement("iframe");
  // Inside the viewport and invisible — Chrome pauses a frame it treats as out of
  // view, which stops the page from finishing (see download-link.tsx).
  Object.assign(frame.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: "1200px",
    height: "1600px",
    border: "0",
    opacity: "0",
    pointerEvents: "none",
    zIndex: "-1",
  });
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;

  let opened = false;
  const cleanup = () => {
    window.removeEventListener("message", onMessage);
    clearTimeout(timer);
    // A moment's grace: some browsers are still handing the job to the printer.
    setTimeout(() => frame.remove(), 1000);
    on.onDone?.();
  };
  const onMessage = (e: MessageEvent<PrintMessage>) => {
    if (e.origin !== window.location.origin || e.source !== frame.contentWindow) return;
    if (e.data?.type !== "flexica-print") return;
    if (e.data.stage === "opened") {
      opened = true;
      on.onOpened?.();
    } else cleanup();
  };
  // Only for a page that never got as far as opening the dialog.
  const timer = setTimeout(() => {
    if (opened) return;
    cleanup();
    toast.error("The print didn't open (the page did not finish loading). Try again, or open the print page.");
  }, 60_000);
  window.addEventListener("message", onMessage);

  const url = new URL(href, window.location.href);
  url.searchParams.set(PRINT_MODE_PARAM, paper);
  frame.src = url.pathname + url.search;
  document.body.appendChild(frame);
}
