import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { report } from "@/core/observability";

/**
 * FlexicaAI's own logo as a `data:` URI, for documents WE issue (subscription
 * invoices). Inlined for the same reason as a clinic's logo (`core/clinics/logo.ts`):
 * the image is in the server-rendered HTML, so it is there when the print dialog opens
 * before React starts, and the browser-made PDF does not have to fetch it.
 *
 * `public/logo.svg` is a wrapper around one embedded PNG; the PNG itself is returned,
 * because an SVG drawn through `<img>` is a second rendering path the PDF builder does
 * not need. Read once per process.
 */
let cached: Promise<string | null> | null = null;

export function getCompanyLogoDataUri(): Promise<string | null> {
  cached ??= (async () => {
    try {
      const svg = await readFile(path.join(process.cwd(), "public", "logo.svg"), "utf8");
      const png = /href="(data:image\/png;base64,[A-Za-z0-9+/=]+)"/.exec(svg)?.[1];
      return png ?? `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    } catch (e) {
      report(e, { op: "brand.companyLogo", severity: "warn" });
      cached = null; // try again next time rather than printing logo-less forever
      return null;
    }
  })();
  return cached;
}
