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
  process.env.NEXT_PUBLIC_BRAND_WEBSITE?.trim() || "www.flexicaai.com";

// Local form (leading 0), not E.164: this is read by a Pakistani audience on a
// printed receipt, and "0301…" is how they will dial it. The E.164 form of the same
// number lives in `contact-details.ts` for the wa.me link and the structured data,
// which both require it — keep the two in step.
export const BRAND_PHONE =
  process.env.NEXT_PUBLIC_BRAND_PHONE?.trim() || "03010186111";

/**
 * The company's contact email. NOT part of the printed credit above — it is the
 * fallback shown to a clinic that has no account manager, beside `BRAND_PHONE`.
 *
 * It lives here rather than in `app/(marketing)/contact-details.ts` because core may
 * not import a route group (ADR-029), and this is read from `core/clinics`. Keep the
 * two in step if either changes.
 */
export const BRAND_EMAIL =
  process.env.NEXT_PUBLIC_BRAND_EMAIL?.trim() || "flexicaai@gmail.com";

/** The one-line credit rendered at the bottom of exported / printed documents. */
export const BRAND_POWERED_BY = `Powered by ${BRAND_WEBSITE} | ${BRAND_PHONE}`;
