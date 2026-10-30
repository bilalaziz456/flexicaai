import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";
import { notDeleted } from "@/core/db/tenant";
import sharp from "sharp";
import { readFileByKey } from "@/core/integrations/storage";
import { report } from "@/core/observability";

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
  } catch (e) {
    // A logo key that no longer resolves means invoices silently print without the
    // clinic branding — visible to patients, invisible to us until now.
    report(e, { op: "clinics.getLogoDataUri", severity: "warn", ids: { logoKey } });
    return null; // missing file → show nothing
  }
}

/**
 * The logo as a THERMAL printer should get it: pure black on white, empty margins
 * trimmed, at most 900 px wide (owner's call, 2026-10-31 — clinics just upload their
 * logo, in colour, and the receipt must still come out clean). A thermal head has no
 * grey, so left to the printer a coloured logo was dithered into faint speckles. Every
 * pixel darker than light grey becomes black; lighter ones become paper. The ORIGINAL
 * is untouched and still prints on A4/A5.
 *
 * Cached per storage key: a new upload gets a new key, and converting on every receipt
 * would cost a decode for the same answer. Any failure falls back to the original.
 */
const thermalCache = new Map<string, string>();
const THERMAL_CACHE_MAX = 200;

export async function getClinicThermalLogoDataUri(logoKey: string | null | undefined): Promise<string | null> {
  if (!logoKey) return null;
  const hit = thermalCache.get(logoKey);
  if (hit) return hit;
  try {
    const data = await readFileByKey(logoKey);
    const png = await sharp(data)
      .flatten({ background: "#ffffff" }) // transparent areas are paper
      .grayscale()
      .threshold(200)
      .trim({ background: "#ffffff" })
      .resize({ width: 900, withoutEnlargement: true })
      .png({ palette: true, colours: 2 })
      .toBuffer();
    const uri = `data:image/png;base64,${png.toString("base64")}`;
    if (thermalCache.size >= THERMAL_CACHE_MAX) thermalCache.clear();
    thermalCache.set(logoKey, uri);
    return uri;
  } catch (e) {
    report(e, { op: "clinics.getThermalLogo", severity: "warn", ids: { logoKey } });
    return getClinicLogoDataUri(logoKey);
  }
}

/**
 * A clinic's logo key plus its account manager — what `GET /api/admin/clinics/[id]/logo`
 * needs to serve the file AND decide whether this admin may see it.
 *
 * Both in one row on purpose: fetching the key and then separately asking who manages
 * the clinic invites a caller to serve the file before checking. `notDeleted` because
 * this is the company reading a LIVE clinic's branding — a trashed clinic's logo is
 * not something the panel should be serving.
 */
export async function getClinicLogoAccess(clinicId: string) {
  const [row] = await db
    .select({ logoKey: clinics.logoKey, assignedTo: clinics.assignedTo })
    .from(clinics)
    .where(and(eq(clinics.id, clinicId), notDeleted(clinics.deletedAt)))
    .limit(1);
  return row ?? null;
}
