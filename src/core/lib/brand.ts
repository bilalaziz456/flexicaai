/**
 * Company brand contact — CORE, specialty-agnostic. The website + phone shown in the
 * "Powered by" credit at the foot of every exported / printed document: the CSV
 * report exports, the prescription PDF, and all print-to-PDF invoices, receipts and
 * statements.
 *
 * Both values are env-driven so they can be changed without touching code. The
 * `NEXT_PUBLIC_` prefix is deliberate — some consumers are client components (e.g.
 * the print frame), and Next inlines `NEXT_PUBLIC_*` into the client bundle at build
 * time. Server code reads the same vars. Company defaults are the fallback.
 */
export const BRAND_WEBSITE =
  process.env.NEXT_PUBLIC_BRAND_WEBSITE?.trim() || "www.klenic.com";

export const BRAND_PHONE =
  process.env.NEXT_PUBLIC_BRAND_PHONE?.trim() || "03000186120";

/** The one-line credit rendered at the bottom of exported / printed documents. */
export const BRAND_POWERED_BY = `Powered by ${BRAND_WEBSITE} | ${BRAND_PHONE}`;
