"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "@/core/ui/toast";
import { cn } from "@/core/lib/utils";
import { PDF_MODE_PARAM, savePdf, type PdfMessage } from "@/core/ui/download-pdf";

/**
 * "Download" beside a "Print …" link — the PDF straight to the computer, without
 * opening the print page (owner's call, 2026-10-15).
 *
 * It loads that print page in a hidden frame with `?pdf=1`; the page makes its own PDF
 * (the very layout it would print) and posts the bytes back here, and this page saves
 * them. Only our own pages may be framed this way — the print routes allow
 * `frame-ancestors 'self'` and nothing else (src/proxy.ts#isFrameableByUs).
 */
export function DownloadLink({
  href,
  label = "Download",
  className,
}: {
  /** The print page this downloads, exactly as the Print link opens it. */
  href: string;
  label?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  const run = () => {
    if (busy) return;
    setBusy(true);
    downloadDocument(href, () => setBusy(false));
  };

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium underline-offset-4 hover:underline disabled:opacity-60",
        className,
      )}
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
      {busy ? "Preparing…" : label}
    </button>
  );
}

/**
 * Save a print page's PDF without opening it — the mechanism behind every Download,
 * exported so a menu can offer it too. `onDone` runs when the file is saved or the
 * attempt fails (a failure is toasted here).
 */
export function downloadDocument(href: string, onDone?: () => void): void {
  const frame = document.createElement("iframe");
  // INSIDE the viewport, invisible and behind everything — never off screen. Chrome
  // pauses animation frames for a frame it considers out of view, and React reveals
  // streamed content on an animation frame, so a frame parked at -10000px never
  // finished loading and every Download timed out (owner's report, 2026-10-15).
  // Desktop width so the page lays out as it prints.
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

  // The reason is shown so a failure can be reported precisely, not just "it broke".
  const finish = (ok: boolean, reason?: string) => {
    window.removeEventListener("message", onMessage);
    clearTimeout(timer);
    frame.remove();
    onDone?.();
    if (!ok) {
      toast.error(`Couldn't make the PDF (${reason ?? "unknown error"}). Open Print and choose “Save as PDF” instead.`);
    }
  };
  const onMessage = (e: MessageEvent<PdfMessage>) => {
    // Only our own hidden page, never another window or origin.
    if (e.origin !== window.location.origin || e.source !== frame.contentWindow) return;
    if (e.data?.type !== "flexica-pdf") return;
    if (e.data.ok) {
      savePdf(e.data.bytes, e.data.name);
      finish(true);
    } else {
      finish(false, e.data.reason);
    }
  };
  // A page that never answers (signed out, an error page) must not leave the
  // button spinning forever.
  const timer = setTimeout(() => finish(false, "the page did not finish loading"), 60_000);
  window.addEventListener("message", onMessage);

  const url = new URL(href, window.location.href);
  url.searchParams.set(PDF_MODE_PARAM, "1");
  frame.src = url.pathname + url.search;
  document.body.appendChild(frame);
}
