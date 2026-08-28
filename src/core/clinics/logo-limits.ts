/**
 * Clinic-logo upload constraints — shared by the SERVER action and CLIENT-side
 * validation, so it's kept free of server-only deps (no storage/db imports) and can
 * be imported into a "use client" form. The byte cap is set just UNDER the 1 MiB
 * Server-Action body limit so a valid upload can't be rejected by multipart overhead.
 */

/** Accepted image types → file extension. */
export const LOGO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** ~1 MB. Below the 1 MiB (1,048,576 B) default Server-Action body limit. */
export const MAX_LOGO_BYTES = 1_000_000;

/**
 * Longest side the logo is downscaled to in the browser before upload.
 *
 * 600px is set by the PRINT use, not the screen one: the logo is re-inlined as a
 * base64 data URI into every invoice and receipt, and at a ~2in printed width 600px
 * is around 300dpi — past what a thermal or office printer resolves. Anything larger
 * is bytes on every single printed document for no visible gain.
 *
 * The shrink happens BEFORE the size check, so a 4 MB photo of a signboard now
 * succeeds instead of being rejected for being over the cap.
 */
export const LOGO_MAX_PX = 600;
