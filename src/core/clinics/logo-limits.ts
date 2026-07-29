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
