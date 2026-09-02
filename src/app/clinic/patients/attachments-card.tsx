"use client";

import { downscaleImage } from "@/core/lib/image-resize";

import { useRef, useState, useTransition } from "react";
import { FileText, Trash2, Upload } from "lucide-react";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Badge } from "@/core/ui/badge";
import { Toast } from "@/core/ui/toast";
import { labelFrom, useVocabulary } from "@/core/ui/vocabulary-provider";
import {
  deleteAttachmentAction,
  setPhotoConsentAction,
  uploadAttachmentAction,
} from "./attachment-actions";

export type AttachmentRow = {
  id: string;
  kind: string;
  caption: string | null;
  mime: string | null;
  isPhoto: boolean;
  uploadedByName: string | null;
  createdAt: string; // preformatted
};


/** Clinical imaging & documents — gallery + upload + photo-consent, per patient. */
export function AttachmentsCard({
  attachments,
  patientId,
  photoConsent,
  canUpload,
  canDelete,
}: {
  attachments: AttachmentRow[];
  patientId: string;
  photoConsent: boolean;
  canUpload: boolean;
  canDelete: boolean;
}) {
  // Labels come from the database (ADR-027); read once, since a hook cannot run
  // inside a map callback below.
  const kindLabels = useVocabulary("attachment_kinds");
  const formRef = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState("xray");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [nonce, setNonce] = useState(0);
  const flash = (text: string, error = false) => {
    setMsg({ text, error });
    setNonce((n) => n + 1);
  };

  const upload = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      // Attach a small gallery copy alongside the ORIGINAL, which goes up untouched:
      // these are diagnostic images and resizing one on the way in would discard
      // detail a clinician may need months later. Best-effort — `downscaleImage`
      // returns null for non-images and for anything it cannot decode, and a missing
      // thumbnail only costs the grid its optimisation.
      const picked = fd.get("file");
      if (picked instanceof File && picked.type.startsWith("image/")) {
        const thumb = await downscaleImage(picked, {
          maxPx: 640,
          quality: 0.7,
          mime: "image/jpeg",
          name: "thumb.jpg",
        });
        if (thumb) fd.append("thumb", thumb);
      }

      const r = await uploadAttachmentAction(patientId, fd);
      if (r.error) flash(r.error, true);
      else {
        flash("Uploaded.");
        formRef.current?.reset();
        setKind("xray");
      }
    });
  };

  const del = (id: string) =>
    start(async () => {
      const r = await deleteAttachmentAction(id, patientId);
      flash(r.error ?? "Removed.", Boolean(r.error));
    });

  const toggleConsent = () =>
    start(async () => {
      const r = await setPhotoConsentAction(patientId, !photoConsent);
      flash(r.error ?? (!photoConsent ? "Photo consent recorded." : "Photo consent withdrawn."), Boolean(r.error));
    });

  return (
    <div className="space-y-4">
      {/* Photo-consent state */}
      {canUpload ? (
        <label className="flex min-h-6 items-center gap-2 text-sm">
          <input type="checkbox" checked={photoConsent} onChange={toggleConsent} disabled={pending} className="size-4 accent-[var(--color-primary)]" />
          Patient consents to clinical photos
          {!photoConsent ? <span className="text-xs text-muted-foreground">(required to upload photos)</span> : null}
        </label>
      ) : null}

      {/* Gallery */}
      {attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No attachments yet.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {attachments.map((a) => {
            const isImage = (a.mime ?? "").startsWith("image/");
            return (
              <li key={a.id} className="group relative overflow-hidden rounded-lg border">
                <a href={`/api/clinical/attachment/${a.id}`} target="_blank" rel="noreferrer" className="block">
                  {isImage ? (
                    // `?thumb=1` serves the small copy when one exists and silently
                    // falls back to the original otherwise, so this grid no longer
                    // downloads full-size diagnostic images to draw 150px squares.
                    // The link around it still opens the untouched original.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/clinical/attachment/${a.id}?thumb=1`}
                      alt={a.caption ?? labelFrom(kindLabels, a.kind)}
                      loading="lazy"
                      decoding="async"
                      className="aspect-square w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-square w-full flex-col items-center justify-center gap-1 bg-muted text-muted-foreground">
                      <FileText className="size-8" aria-hidden="true" />
                      <span className="text-xs">{labelFrom(kindLabels, a.kind)}</span>
                    </div>
                  )}
                </a>
                <div className="space-y-0.5 p-1.5">
                  <div className="flex items-center justify-between gap-1">
                    <Badge variant="secondary" className="text-[10px]">{labelFrom(kindLabels, a.kind)}</Badge>
                    {canDelete ? (
                      <button type="button" onClick={() => del(a.id)} disabled={pending} aria-label="Remove" className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="size-3.5" />
                      </button>
                    ) : null}
                  </div>
                  {a.caption ? <p className="truncate text-xs">{a.caption}</p> : null}
                  <p className="truncate text-[10px] text-muted-foreground">{a.createdAt}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Upload */}
      {canUpload ? (
        <form ref={formRef} onSubmit={upload} className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
          <div className="space-y-1">
            <label htmlFor="att-file" className="text-xs text-muted-foreground">File</label>
            <input id="att-file" name="file" type="file" accept="image/*,application/pdf" required className="block max-w-52 text-sm" />
          </div>
          <div className="space-y-1">
            <label htmlFor="att-kind" className="text-xs text-muted-foreground">Type</label>
            <select
              id="att-kind"
              name="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="h-9 rounded-lg border border-input bg-[var(--input-bg)] pl-2 pr-8 text-sm outline-none select-chevron"
            >
              <option value="xray">X-ray</option>
              <option value="photo" disabled={!photoConsent}>Photo{!photoConsent ? " (needs consent)" : ""}</option>
              <option value="document">Document</option>
              <option value="consent">Consent form</option>
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="att-caption" className="text-xs text-muted-foreground">Caption</label>
            <Input id="att-caption" name="caption" placeholder="Optional" className="h-9 w-40" />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            <Upload className="size-4" /> {pending ? "Uploading…" : "Upload"}
          </Button>
        </form>
      ) : null}

      <Toast message={msg?.text ?? null} variant={msg?.error ? "error" : "success"} token={nonce} />
    </div>
  );
}
