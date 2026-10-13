"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, Trash2 } from "lucide-react";
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
 * or the PDF itself) with Prev / Next through the set, open-in-new-tab and download;
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
          {isImage(current) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={current.id}
              src={fileUrl(current.id)}
              alt={current.caption ?? labelOf(current)}
              className="mx-auto max-h-[65vh] w-auto max-w-full rounded-md object-contain"
            />
          ) : isPdf(current) ? (
            <iframe
              key={current.id}
              src={fileUrl(current.id)}
              title={current.caption ?? labelOf(current)}
              className="h-[65vh] w-full rounded-md border"
            />
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
