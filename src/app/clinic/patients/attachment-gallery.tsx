"use client";

import { useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Maximize2,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Badge } from "@/core/ui/badge";
import { Button, buttonVariants } from "@/core/ui/button";
import { ConfirmDialog } from "@/core/ui/confirm-dialog";
import { Dialog } from "@/core/ui/dialog";
import { cn } from "@/core/lib/utils";
import type { AttachmentRow } from "./attachments-card";

const fileUrl = (id: string) => `/api/clinical/attachment/${id}`;
const isImage = (a: AttachmentRow) => (a.mime ?? "").startsWith("image/");
const isPdf = (a: AttachmentRow) => a.mime === "application/pdf";

/**
 * A patient's clinical files as a grid of tiles — shared by Imaging & documents and
 * the Medical history documents. A tile opens the file in a VIEWER dialog (an image,
 * or the PDF itself) with zoom, Prev / Next through the set, open-in-new-tab and download;
 * deleting always asks first. The file is served by the authorised route, which our
 * own pages alone may frame (src/proxy.ts) — that is what lets a PDF show here.
 */
export function AttachmentGallery({
  attachments,
  labelOf,
  canDelete,
  onDelete,
}: {
  attachments: AttachmentRow[];
  /** The tile's type badge ("X-ray", "Medical history"). */
  labelOf: (a: AttachmentRow) => string;
  canDelete: boolean;
  /** Runs from the confirmation dialog; an error keeps it open and is shown there. */
  onDelete: (id: string) => Promise<{ error?: string } | void>;
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const current = openIdx !== null ? attachments[openIdx] : null;

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {attachments.map((a, idx) => (
          <li key={a.id} className="group relative overflow-hidden rounded-lg border">
            <div className="relative">
              {isImage(a) ? (
                // `?thumb=1` serves the small copy when one exists and falls back to
                // the original; the viewer opens the untouched original.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`${fileUrl(a.id)}?thumb=1`}
                  alt={a.caption ?? labelOf(a)}
                  loading="lazy"
                  decoding="async"
                  className="aspect-square w-full object-cover"
                />
              ) : isPdf(a) ? (
                // The first page, drawn by the browser's own PDF viewer with its
                // toolbar hidden — a preview with no extra library and no stored
                // thumbnail. Inert: the button laid over it is what opens the viewer.
                <iframe
                  src={`${fileUrl(a.id)}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                  title={a.caption ?? labelOf(a)}
                  loading="lazy"
                  tabIndex={-1}
                  aria-hidden="true"
                  className="pointer-events-none aspect-square w-full overflow-hidden border-0 bg-white"
                />
              ) : (
                <div className="flex aspect-square w-full flex-col items-center justify-center gap-1 bg-muted text-muted-foreground">
                  <FileText className="size-8" aria-hidden="true" />
                  <span className="text-xs">{labelOf(a)}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => setOpenIdx(idx)}
                className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset"
                aria-label={`Open ${a.caption ?? labelOf(a)}`}
              />
            </div>
            <div className="space-y-0.5 p-1.5">
              <div className="flex items-center justify-between gap-1">
                <Badge variant="secondary" className="text-[10px]">{labelOf(a)}</Badge>
                {canDelete ? (
                  <ConfirmDialog
                    triggerLabel="Delete"
                    triggerIcon={<Trash2 className="size-3.5" aria-hidden="true" />}
                    triggerVariant="ghost"
                    // Icon-only on a small tile; "Delete" stays as the button's name.
                    triggerClassName="h-6 w-6 p-0 text-muted-foreground hover:text-destructive [&>span]:hidden"
                    title="Delete this file?"
                    description={`"${a.caption ?? labelOf(a)}" uploaded ${a.createdAt} will be removed from the patient's record.`}
                    confirmLabel="Delete"
                    confirmVariant="destructive"
                    cancelLabel="Keep"
                    onConfirm={() => onDelete(a.id)}
                  />
                ) : null}
              </div>
              {a.caption ? <p className="truncate text-xs">{a.caption}</p> : null}
              <p className="truncate text-[10px] text-muted-foreground">
                {a.createdAt}
                {a.uploadedByName ? ` · ${a.uploadedByName}` : ""}
              </p>
            </div>
          </li>
        ))}
      </ul>

      {current ? (
        <Dialog
          open
          onOpenChange={(next) => (next ? null : setOpenIdx(null))}
          size="xl"
          title={current.caption ?? labelOf(current)}
          description={`${labelOf(current)} · ${current.createdAt}${current.uploadedByName ? ` · ${current.uploadedByName}` : ""}`}
          footer={
            <>
              {attachments.length > 1 ? (
                <div className="mr-auto flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={openIdx === 0}
                    onClick={() => setOpenIdx((i) => (i === null ? i : Math.max(0, i - 1)))}
                  >
                    <ChevronLeft className="size-4" aria-hidden="true" /> Prev
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {(openIdx ?? 0) + 1} of {attachments.length}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={openIdx === attachments.length - 1}
                    onClick={() => setOpenIdx((i) => (i === null ? i : Math.min(attachments.length - 1, i + 1)))}
                  >
                    Next <ChevronRight className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              ) : null}
              <a
                href={fileUrl(current.id)}
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                <ExternalLink className="size-4" aria-hidden="true" /> Open in new tab
              </a>
              <a
                href={fileUrl(current.id)}
                download
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                <Download className="size-4" aria-hidden="true" /> Download
              </a>
            </>
          }
        >
          {isImage(current) || isPdf(current) ? (
            // Keyed on the file so Prev / Next starts the next one back at Fit.
            <ZoomableFile key={current.id} attachment={current} title={current.caption ?? labelOf(current)} />
          ) : (
            <p className="py-10 text-center text-muted-foreground">
              This file can&apos;t be previewed. Use Download to open it.
            </p>
          )}
        </Dialog>
      ) : null}
    </>
  );
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;

/**
 * An image or PDF with one set of zoom controls, so the two kinds of file behave the
 * same in the viewer. It opens at FIT — the whole page or picture visible — and zooming
 * in scrolls inside the frame, which is what reading a small scanned report needs.
 *
 * The two are zoomed differently because only one of them is ours to draw:
 * - an IMAGE is sized in pixels from its natural size × the fit scale × the zoom.
 *   Sized, not `transform: scale()`, because a transform does not grow the scroll
 *   area to the left, so a zoomed picture could not be scrolled back to its left edge.
 * - a PDF is drawn by the browser's own viewer, which reads `#zoom=` from the URL
 *   (`#view=FitH` for fit). The frame is re-mounted per level, since a viewer does
 *   not reliably react to the fragment changing; the file is cached, so it is quick.
 */
function ZoomableFile({ attachment, title }: { attachment: AttachmentRow; title: string }) {
  const [zoom, setZoom] = useState(1);
  const frameRef = useRef<HTMLDivElement>(null);
  // The picture's size at Fit, measured once it has loaded.
  const [fitSize, setFitSize] = useState<{ w: number; h: number } | null>(null);

  const zoomBy = (delta: number) =>
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) * 100) / 100)));

  function measureFit(img: HTMLImageElement) {
    const frame = frameRef.current;
    if (!frame || !img.naturalWidth || !img.naturalHeight) return;
    // Never enlarge a small picture to fit — 100% stays its real size then.
    const scale = Math.min(
      frame.clientWidth / img.naturalWidth,
      frame.clientHeight / img.naturalHeight,
      1,
    );
    setFitSize({ w: img.naturalWidth * scale, h: img.naturalHeight * scale });
  }

  const pdfSrc = `${fileUrl(attachment.id)}#${zoom === 1 ? "view=FitH" : `zoom=${Math.round(zoom * 100)}`}`;
  // "Fit", not "100%": the browser's PDF viewer prints its own real percentage, and at
  // fit that is rarely 100 — two different numbers for one view would read as a bug.
  const zoomLabel = zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`;

  return (
    <div
      className="space-y-2"
      // + / - / 0 while the viewer has focus, like a browser's own zoom keys.
      onKeyDown={(e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === "+" || e.key === "=") zoomBy(ZOOM_STEP);
        else if (e.key === "-") zoomBy(-ZOOM_STEP);
        else if (e.key === "0") setZoom(1);
        else return;
        e.preventDefault();
      }}
    >
      <div className="flex items-center justify-center gap-1" role="group" aria-label="Zoom">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => zoomBy(-ZOOM_STEP)}
          disabled={zoom <= ZOOM_MIN}
          aria-label="Zoom out"
          title="Zoom out (-)"
        >
          <ZoomOut className="size-4" aria-hidden="true" />
        </Button>
        <span className="w-14 text-center text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {zoomLabel}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => zoomBy(ZOOM_STEP)}
          disabled={zoom >= ZOOM_MAX}
          aria-label="Zoom in"
          title="Zoom in (+)"
        >
          <ZoomIn className="size-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setZoom(1)}
          disabled={zoom === 1}
          title="Fit to the window (0)"
        >
          <Maximize2 className="size-3.5" aria-hidden="true" /> Fit
        </Button>
      </div>

      {isPdf(attachment) ? (
        <iframe
          key={zoom}
          src={pdfSrc}
          title={title}
          className="h-[min(65vh,calc(90vh-15rem))] w-full rounded-md border"
        />
      ) : (
        <div
          ref={frameRef}
          // Flex + `m-auto` on the picture centres it while it is smaller than the
          // frame, and — unlike justify-center — still lets every edge scroll into
          // view once it is larger.
          className="flex h-[min(65vh,calc(90vh-15rem))] w-full overflow-auto rounded-md"
          tabIndex={0}
          aria-label={`${title}, ${zoomLabel}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fileUrl(attachment.id)}
            alt={title}
            onLoad={(e) => measureFit(e.currentTarget)}
            style={
              fitSize
                ? { width: fitSize.w * zoom, height: fitSize.h * zoom, maxWidth: "none" }
                : undefined
            }
            className={cn("m-auto shrink-0 rounded-md", !fitSize && "max-h-full max-w-full object-contain")}
          />
        </div>
      )}
    </div>
  );
}
