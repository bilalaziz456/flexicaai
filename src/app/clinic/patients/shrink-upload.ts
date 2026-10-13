"use client";

import { downscaleImage } from "@/core/lib/image-resize";
import { SHRINK_MAX_PX, SHRINK_QUALITY } from "@/core/patients/attachment-limits";

/**
 * A phone photo of a prescription is 2–5 MB and needs none of it: shrunk to
 * SHRINK_MAX_PX on its longest side as a good JPEG it is ~0.5–1 MB and the handwriting
 * still reads. Returns the smaller file, or the original when shrinking would not help
 * (already small, not an image, could not decode). NEVER for an X-ray — callers skip
 * it there, because a diagnostic image keeps every pixel.
 */
export async function shrinkForUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  const base = file.name.replace(/\.[^.]+$/, "") || "image";
  const small = await downscaleImage(file, {
    maxPx: SHRINK_MAX_PX,
    quality: SHRINK_QUALITY,
    mime: "image/jpeg",
    name: `${base}.jpg`,
  });
  return small && small.size < file.size ? small : file;
}
