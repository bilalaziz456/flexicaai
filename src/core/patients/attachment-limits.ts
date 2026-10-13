/**
 * Upload limits for clinical attachments — PURE, so the picker in the browser and the
 * server action enforce the same numbers (owner's call, 2026-10-14).
 *
 * 5 MB per file. Enough for any document (a scanned prescription or report PDF is
 * usually 0.2–2 MB) because PHOTOS are shrunk in the browser before upload
 * (`SHRINK_MAX_PX`); an X-ray is never shrunk — it is a diagnostic image — and an
 * exported X-ray is normally well under 5 MB.
 *
 * THREE limits must agree, and two of them are not in this file: Next's Server Action
 * body limit (`serverActions.bodySizeLimit` in next.config.ts, set just above this so
 * the form overhead fits) and nginx's `client_max_body_size` on the server
 * (docs/launch-checklist.md). Either one left at its 1 MB default silently caps every
 * upload at 1 MB, whatever this says.
 */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENT_LABEL = "5 MB";

/** Longest side, in px, a photo or scanned page is shrunk to before upload. */
export const SHRINK_MAX_PX = 2500;
/** JPEG quality for that shrink — handwriting stays readable. */
export const SHRINK_QUALITY = 0.85;

/** "7.2 MB" / "640 KB". */
export function fileSizeLabel(n: number): string {
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}
