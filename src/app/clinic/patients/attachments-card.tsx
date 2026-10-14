"use client";

import { downscaleImage } from "@/core/lib/image-resize";
import { Checkbox } from "@/core/ui/checkbox";
import { SelectField } from "@/core/ui/select-field";
import { EmptyState } from "@/core/ui/empty-state";

import { useRef, useState, useTransition } from "react";
import { Upload, Paperclip, ShieldAlert, ShieldCheck } from "lucide-react";
import { AttachmentGallery } from "./attachment-gallery";
import { FilePicker } from "./file-picker";
import { shrinkForUpload } from "./shrink-upload";
import { Label } from "@/core/ui/label";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
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
  const [file, setFile] = useState<File | null>(null);
  // Bumped after an upload so the picker starts clean (its "too large" notes too).
  const [pickerKey, setPickerKey] = useState(0);
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
      // The picker keeps the file in state (its input is the hidden half of a button).
      if (!file) return;
      // An X-ray keeps every pixel; anything else (a photo, a scanned form) is shrunk.
      const toSend = kind === "xray" ? file : await shrinkForUpload(file);
      fd.set("file", toSend);
      const picked = toSend;
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
        setFile(null);
        setPickerKey((k) => k + 1);
        setKind("xray");
      }
    });
  };

  // Runs from the gallery's confirmation dialog: an error keeps it open and shows there.
  const del = async (id: string) => {
    const r = await deleteAttachmentAction(id, patientId);
    if (r.error) return { error: r.error };
    flash("Deleted.");
  };

  const toggleConsent = () =>
    start(async () => {
      const r = await setPhotoConsentAction(patientId, !photoConsent);
      flash(r.error ?? (!photoConsent ? "Photo consent recorded." : "Photo consent withdrawn."), Boolean(r.error));
    });

  return (
    <div className="space-y-4">
      {/* Photo consent is RECOMMENDED for every patient (owner's call, 2026-10-15), so
          until it is given it is a visible prompt to ask, not a quiet checkbox. It is
          never ticked by default: the tick records that the patient said yes, and a
          default would record a yes nobody gave — the one thing consent exists to
          prevent. */}
      {canUpload ? (
        photoConsent ? (
          <label className="flex min-h-6 items-center gap-2 text-sm">
            <Checkbox checked onCheckedChange={toggleConsent} disabled={pending} />
            <ShieldCheck className="size-4 text-success-text" aria-hidden="true" />
            Patient has consented to clinical photos
            <span className="text-xs text-muted-foreground">(untick if they withdraw it)</span>
          </label>
        ) : (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-400/60 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <p>
                <span className="font-semibold">Recommended: ask the patient for photo consent.</span>{" "}
                Without it, clinical photos can&apos;t be uploaded or viewed for this patient.
                X-rays and documents don&apos;t need it.
              </p>
              <label className="flex min-h-6 items-center gap-2 font-medium">
                <Checkbox checked={false} onCheckedChange={toggleConsent} disabled={pending} />
                The patient agrees to clinical photos
              </label>
            </div>
          </div>
        )
      ) : null}

      {/* Gallery */}
      {attachments.length === 0 ? (
        <EmptyState
          compact
          icon={Paperclip}
          title="No attachments yet"
          description="X-rays, photos, consent forms and documents for this patient appear here."
        />
      ) : (
        <AttachmentGallery
          attachments={attachments}
          labelOf={(a) => labelFrom(kindLabels, a.kind)}
          canDelete={canDelete}
          onDelete={del}
        />
      )}

      {/* Upload */}
      {canUpload ? (
        <form ref={formRef} onSubmit={upload} className="flex flex-wrap items-end gap-2 rounded-xl border border-border/70 bg-surface-sunken p-3.5">
          <div className="w-full space-y-1.5">
            <Label>File</Label>
            <FilePicker
              key={pickerKey}
              files={file ? [file] : []}
              onChange={(f) => setFile(f[0] ?? null)}
              accept="image/jpeg,image/png,image/webp,application/pdf"
              shrinksImages={kind !== "xray"}
              hint={`JPG, PNG, WebP or PDF · up to 5 MB${kind === "xray" ? "" : " (photos are shrunk automatically)"}`}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="att-kind">Type</Label>
            {/* Photo stays VISIBLE and unselectable without consent rather than
                disappearing: an option that is simply absent tells the uploader
                nothing about why, and consent is the whole point of the rule
                (conventions §13). This is what `disabled` on an option is for. */}
            <SelectField
              id="att-kind"
              name="kind"
              value={kind}
              onValueChange={setKind}
              options={[
                { value: "xray", label: "X-ray" },
                {
                  value: "photo",
                  label: photoConsent ? "Photo" : "Photo (needs consent)",
                  disabled: !photoConsent,
                },
                { value: "document", label: "Document" },
                { value: "consent", label: "Consent form" },
              ]}
              ariaLabel="Attachment type"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="att-caption">Label (optional)</Label>
            <Input id="att-caption" name="caption" placeholder="File name if empty" className="h-9 w-48" />
          </div>
          <Button type="submit" size="sm" className="h-9" disabled={pending || !file}>
            <Upload className="size-4" /> {pending ? "Uploading…" : "Upload"}
          </Button>
        </form>
      ) : null}

      <Toast message={msg?.text ?? null} variant={msg?.error ? "error" : "success"} token={nonce} />
    </div>
  );
}
