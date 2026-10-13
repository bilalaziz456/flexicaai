"use client";

import { useId, useState } from "react";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_LABEL, fileSizeLabel } from "@/core/patients/attachment-limits";
import { FileText, ImageIcon, Paperclip, X } from "lucide-react";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";


/**
 * A file picker that looks like the rest of the app: the LABEL is the button (a file
 * input's own "Choose Files / No file chosen" cannot be styled to match), and what was
 * picked is listed by name and size, each removable — a picker that says nothing after
 * a pick looks as if it did not work. The chosen files live in the caller's state, so
 * picking again ADDS to the list instead of silently replacing it.
 */
export function FilePicker({
  files,
  onChange,
  accept,
  multiple = false,
  label = multiple ? "Choose files" : "Choose file",
  hint,
  shrinksImages = false,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  accept: string;
  multiple?: boolean;
  label?: string;
  hint?: string;
  /** Images will be shrunk before upload, so an oversized photo is let through here. */
  shrinksImages?: boolean;
}) {
  const id = useId();
  // Files refused at pick time, named — said now, not after a slow upload fails.
  const [refused, setRefused] = useState<string[]>([]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "cursor-pointer")}>
          <Paperclip className="size-4" aria-hidden="true" />
          {files.length > 0 && !multiple ? "Choose another" : label}
        </label>
        <input
          id={id}
          type="file"
          accept={accept}
          multiple={multiple}
          className="sr-only"
          onChange={(e) => {
            const all = Array.from(e.currentTarget.files ?? []);
            const tooBig = (f: File) =>
              f.size > MAX_ATTACHMENT_BYTES && !(shrinksImages && f.type.startsWith("image/"));
            setRefused(
              all.filter(tooBig).map((f) => `${f.name} is ${fileSizeLabel(f.size)} — the limit is ${MAX_ATTACHMENT_LABEL}.`),
            );
            const picked = all.filter((f) => !tooBig(f));
            onChange(multiple ? [...files, ...picked] : picked.length ? picked.slice(0, 1) : files);
            // Cleared so the same file can be picked again after being removed.
            e.currentTarget.value = "";
          }}
        />
        {files.length === 0 ? (
          <span className="text-sm text-muted-foreground">{hint ?? "No file chosen"}</span>
        ) : null}
      </div>
      {refused.length > 0 ? (
        <ul className="space-y-0.5 text-xs text-destructive-text" role="alert">
          {refused.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      {files.length > 0 ? (
        <ul className="space-y-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-2 text-sm">
              {f.type.startsWith("image/") ? (
                <ImageIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              ) : (
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="min-w-0 truncate">{f.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{fileSizeLabel(f.size)}</span>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
