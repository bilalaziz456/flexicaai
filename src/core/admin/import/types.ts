/**
 * Shared import types + helpers — CORE (client-safe: no server-only, no DB). See
 * docs/import-plan.md.
 */
export type ImportEntity = "patients" | "procedures";

export type RowIssue = { row: number; level: "error" | "warning"; message: string };

export type ImportPreview = {
  entity: ImportEntity;
  headers: string[];
  totalRows: number;
  ready: number; // will be imported
  duplicates: number; // skipped (already exist / in-file dup)
  errored: number; // excluded (missing required field)
  warnings: number; // imported, but flagged
  issues: RowIssue[]; // capped for display
};

export type ImportResult = {
  batchId: string;
  imported: number;
  skipped: number;
  errored: number;
  warnings: number;
};

/** Per-row validation outcome (internal to the entity modules). */
export type RowResult<T> =
  | { kind: "ready"; data: T; warnings: string[] }
  | { kind: "duplicate"; reason: string }
  | { kind: "error"; reason: string };

export const MAX_ISSUES = 200;

/**
 * Best-effort E.164 normalisation for storage. `defaultCc` is the country-code
 * digits assumed for a local number (Pakistan "92" by default; pass the clinic's
 * later). Empty input is allowed (phone is optional). `valid` is false when the
 * result doesn't look like a plausible E.164 number — the caller keeps it but flags it.
 */
export function normalizePhone(raw: string, defaultCc = "92"): { phone: string | null; valid: boolean } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { phone: null, valid: true };
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return { phone: null, valid: true };
  let e164: string;
  if (hasPlus) e164 = "+" + digits;
  else if (digits.startsWith("00")) e164 = "+" + digits.slice(2);
  else if (digits.startsWith("0")) e164 = "+" + defaultCc + digits.slice(1);
  else if (digits.startsWith(defaultCc) && digits.length >= defaultCc.length + 9) e164 = "+" + digits;
  else e164 = "+" + defaultCc + digits;
  return { phone: e164, valid: /^\+\d{10,15}$/.test(e164) };
}

/** Roll per-row results into a preview summary (capped issue list). */
export function summarize<T>(
  entity: ImportEntity,
  headers: string[],
  totalRows: number,
  results: { row: number; res: RowResult<T> }[],
): ImportPreview {
  let ready = 0;
  let duplicates = 0;
  let errored = 0;
  let warnings = 0;
  const issues: RowIssue[] = [];
  const push = (i: RowIssue) => {
    if (issues.length < MAX_ISSUES) issues.push(i);
  };
  for (const { row, res } of results) {
    if (res.kind === "ready") {
      ready++;
      if (res.warnings.length) {
        warnings++;
        for (const message of res.warnings) push({ row, level: "warning", message });
      }
    } else if (res.kind === "duplicate") {
      duplicates++;
      push({ row, level: "warning", message: res.reason });
    } else {
      errored++;
      push({ row, level: "error", message: res.reason });
    }
  }
  return { entity, headers, totalRows, ready, duplicates, errored, warnings, issues };
}

/** A `YYYY-MM-DD` from common date spellings (ISO, DD/MM/YYYY, DD-MM-YYYY). */
export function parseImportDate(s: string): string | null {
  const t = (s ?? "").trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

/** Whole-PKR integer from a possibly comma/space-formatted amount, or null. */
export function parseAmount(s: string): number | null {
  const cleaned = (s ?? "").replace(/[,\s]/g, "");
  if (!cleaned) return null;
  const n = Math.round(Number(cleaned));
  return Number.isFinite(n) ? n : null;
}
