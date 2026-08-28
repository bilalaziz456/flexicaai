/**
 * Browser-side image downscaling — CORE, specialty-agnostic, and deliberately free of
 * any server import so a `"use client"` form can use it.
 *
 * Two callers, two different reasons:
 *   - a clinical attachment generates a small THUMBNAIL alongside the untouched
 *     original, so the patient gallery stops downloading megabytes to draw a 150px
 *     square (the original is diagnostic and is never resized);
 *   - a clinic LOGO is downscaled in place, because it is re-inlined as a base64
 *     data URI into every printed invoice and receipt.
 *
 * Done in the browser rather than on the server on purpose: no native dependency
 * (`CLAUDE.md` §2), no CPU on the single node per upload, and the bytes never cross
 * the wire in the first place. The avatar cropper already works this way.
 *
 * **Every failure returns null rather than throwing.** A thumbnail is an
 * optimisation; a logo shrink is a nicety. Neither is worth failing an upload a
 * clinician is trying to complete — the caller falls back to the original file.
 */

/** Alpha survives PNG/WebP; a JPEG would fill transparency with black. */
const ALPHA_MIMES = new Set(["image/png", "image/webp"]);

export type DownscaleOptions = {
  /** Longest-side budget in pixels. The aspect ratio is kept. */
  maxPx: number;
  /** JPEG/WebP quality, 0–1. Ignored for PNG output. */
  quality?: number;
  /**
   * Force an output type. Default: PNG when the SOURCE may carry transparency
   * (a logo on a transparent background would otherwise print in a black box),
   * JPEG otherwise.
   */
  mime?: string;
  /** Filename to give the returned File. */
  name?: string;
};

/** Decodes to a bitmap, preferring the fast path but falling back for older browsers. */
async function decode(file: File): Promise<ImageBitmap | HTMLImageElement | null> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through — some browsers refuse certain encodings here but load them
      // fine through an <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  } catch {
    return null;
  } finally {
    // Safe immediately: the browser has already decoded from the blob by the time
    // onload fires, and revoking early avoids leaking one URL per upload.
    URL.revokeObjectURL(url);
  }
}

/**
 * Returns a downscaled copy of `file`, or null when it is not an image, cannot be
 * decoded, or is already small enough to leave alone.
 */
export async function downscaleImage(
  file: File,
  opts: DownscaleOptions,
): Promise<File | null> {
  if (!file.type.startsWith("image/")) return null;
  // An SVG has no meaningful pixel size to scale and rasterising one would be a
  // downgrade, so it is passed through untouched.
  if (file.type === "image/svg+xml") return null;

  const source = await decode(file);
  if (!source) return null;

  const width = "width" in source ? source.width : 0;
  const height = "height" in source ? source.height : 0;
  if (!width || !height) return null;

  const longest = Math.max(width, height);
  const scale = Math.min(1, opts.maxPx / longest);
  const outMime = opts.mime ?? (ALPHA_MIMES.has(file.type) ? "image/png" : "image/jpeg");
  // Already within budget AND already in the output format — re-encoding would only
  // lose quality for no saving.
  if (scale === 1 && file.type === outMime) return null;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // Best available resampling; a naive downscale of a photo looks aliased.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, outMime, opts.quality ?? 0.8),
  );
  if (!blob) return null;

  // A "smaller" image that is actually bigger is not worth uploading — this happens
  // with tiny sources and with flat art that was already well compressed.
  if (blob.size >= file.size && scale === 1) return null;

  const ext = outMime === "image/png" ? "png" : outMime === "image/webp" ? "webp" : "jpg";
  return new File([blob], opts.name ?? `image.${ext}`, { type: outMime });
}
