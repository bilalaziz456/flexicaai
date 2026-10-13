"use client";

import { useState, useTransition } from "react";
import { FileUp, Upload } from "lucide-react";
import { downscaleImage } from "@/core/lib/image-resize";
import { Button } from "@/core/ui/button";
import { EmptyState } from "@/core/ui/empty-state";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { FilePicker } from "./file-picker";
import { shrinkForUpload } from "./shrink-upload";
import { toast } from "@/core/ui/toast";
import { deleteAttachmentAction, uploadAttachmentAction } from "./attachment-actions";
import { AttachmentGallery } from "./attachment-gallery";
import type { AttachmentRow } from "./attachments-card";

/** What the file picker offers — the same four types the server accepts. */
const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

/**
 * Documents behind the patient's medical history — another doctor's letter, a
 * prescription listing their medicines, a lab report (owner's ask, 2026-10-13). Kept
 * with the history rather than in the imaging gallery, as kind `history`. Images and
 * PDFs, several at once; each opens in the viewer, and deleting asks first.
 *
 * The file is NOT read for medicines or conditions: those are still entered above,
 * by a person, from what the document says.
 */
export function MedicalHistoryDocuments({
  documents,
  patientId,
  canUpload,
  canDelete,
}: {
  documents: AttachmentRow[];
  patientId: string;
  canUpload: boolean;
  canDelete: boolean;
}) {
  const [pending, start] = useTransition();
  const [files, setFiles] = useState<File[]>([]);
  const [caption, setCaption] = useState("");
  // Bumped after an upload so the picker starts clean (its "too large" notes too).
  const [pickerKey, setPickerKey] = useState(0);

  const upload = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const label = caption.trim();
    if (files.length === 0) {
      toast.error("Choose a file.");
      return;
    }
    start(async () => {
      let done = 0;
      // One upload per file, so one bad file does not lose the others.
      for (const original of files) {
        // Photos are shrunk first (documents, not diagnostic images); a PDF goes as is.
        const file = await shrinkForUpload(original);
        const fd = new FormData();
        fd.set("file", file);
        fd.set("kind", "history");
        // With no label typed the server uses the file's own name.
        if (label) fd.set("caption", files.length > 1 ? `${label} (${done + 1})` : label);
        if (file.type.startsWith("image/")) {
          const thumb = await downscaleImage(file, { maxPx: 640, quality: 0.7, mime: "image/jpeg", name: "thumb.jpg" });
          if (thumb) fd.append("thumb", thumb);
        }
        const r = await uploadAttachmentAction(patientId, fd);
        if (r.error) {
          toast.error(r.error);
          continue;
        }
        done++;
      }
      if (done > 0) {
        toast.success(done === 1 ? "Document uploaded." : `${done} documents uploaded.`);
        setFiles([]);
        setCaption("");
        setPickerKey((k) => k + 1);
      }
    });
  };

  const del = async (id: string) => {
    const r = await deleteAttachmentAction(id, patientId);
    if (r.error) return { error: r.error };
    toast.success("Document deleted.");
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Documents</p>
        <p className="text-xs text-muted-foreground">
          Previous prescriptions, reports and letters about the patient&apos;s medicines and conditions.
        </p>
      </div>

      {documents.length === 0 ? (
        <EmptyState
          compact
          icon={FileUp}
          title="No documents yet"
          description={
            canUpload
              ? "Upload a photo or PDF of an old prescription, a lab report or another doctor's letter."
              : "Documents about the patient's history appear here."
          }
        />
      ) : (
        <AttachmentGallery
          attachments={documents}
          labelOf={(a) => (a.mime === "application/pdf" ? "PDF" : "Image")}
          canDelete={canDelete}
          onDelete={del}
        />
      )}

      {canUpload ? (
        <form onSubmit={upload} className="space-y-3 rounded-xl border well p-3">
          <div className="space-y-1.5">
            <Label>Files</Label>
            <FilePicker
              key={pickerKey}
              files={files}
              onChange={setFiles}
              accept={ACCEPT}
              multiple
              shrinksImages
              hint="JPG, PNG, WebP or PDF · up to 5 MB each (photos are shrunk automatically)"
            />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="mh-caption">Label (optional)</Label>
              <Input
                id="mh-caption"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="e.g. Cardiologist's letter"
                maxLength={200}
                className="h-9 w-64"
              />
            </div>
            <Button type="submit" size="sm" className="h-9" disabled={pending || files.length === 0}>
              <Upload className="size-4" aria-hidden="true" />
              {pending ? "Uploading…" : files.length > 1 ? `Upload ${files.length} files` : "Upload"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Leave the label empty to use each file&apos;s name.</p>
        </form>
      ) : null}
    </div>
  );
}
