/**
 * The paper sizes a clinic prints on, as Print-button keys. PURE (no "use client"),
 * because server pages compute it and hand it to the client `PrintLinks` — calling a
 * function exported from a client module on the server is an error in Next.
 */

/** The paper sizes, in the order Print buttons appear. Keys match the print frame's. */
export const PRINT_PAPERS = [
  { key: "a4", label: "A4" },
  { key: "a5", label: "A5" },
  { key: "thermal", label: "thermal" },
] as const;

/**
 * The clinic's switched-on sizes (`clinics.invoice_papers_enabled`). An unknown or
 * empty list falls back to all of them, like the print frame — a misconfigured clinic
 * must still be able to print.
 */
export function offeredPapers(enabled: readonly string[] | null | undefined): string[] {
  const picked = PRINT_PAPERS.map((p) => p.key).filter((k) => enabled?.includes(k));
  return picked.length ? picked : PRINT_PAPERS.map((p) => p.key);
}

/**
 * A patient's own documents — the account statement, the clinical chart, a treatment
 * estimate — print on A4 only, whatever the clinic's receipt printer (owner's call,
 * 2026-10-18). They are pages a patient keeps or takes elsewhere, not till slips, and a
 * thermal or A5 button beside them only invited the wrong one. Invoices and payment
 * prints still follow `offeredPapers`.
 */
export const PATIENT_DOCUMENT_PAPERS: readonly string[] = ["a4"];

/**
 * The query parameter a "Save & print <size>" redirect carries to the page it lands
 * on, which then prints at that size (core/ui/print-on-arrival). Declared HERE, in a
 * pure module, because the server action builds the URL: imported from the client
 * component, a server file receives a client-module REFERENCE instead of the string,
 * and the redirect header it produced was refused ("Invalid character in header
 * content", 2026-10-18).
 */
export const AUTO_PRINT_PARAM = "printPaper";
