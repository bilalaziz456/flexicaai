import "server-only";

import { readFileByKey } from "@/core/integrations/storage";

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/**
 * Read a clinic's logo and return it as a base64 `data:` URI, or null if there's no
 * logo / it can't be read. Inlining (vs an <img src> route) means the image is IN the
 * server-rendered HTML, so it's guaranteed present when the browser prints — no
 * network-fetch race. Used for both the admin preview and the printed documents.
 */
export async function getClinicLogoDataUri(logoKey: string | null | undefined): Promise<string | null> {
  if (!logoKey) return null;
  try {
    const data = await readFileByKey(logoKey);
    const ext = logoKey.split(".").pop()?.toLowerCase() ?? "";
    const mime = MIME[ext] ?? "application/octet-stream";
    return `data:${mime};base64,${data.toString("base64")}`;
  } catch {
    return null; // missing file → show nothing
  }
}
