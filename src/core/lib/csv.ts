/**
 * Minimal CSV builder — CORE, pure. Quotes any field containing a comma, quote or
 * newline (doubling embedded quotes), per RFC 4180. No dependency.
 */
function esc(v: string | number | null): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One CSV record (escaped, comma-joined) — the unit a streaming export emits. */
export function csvLine(values: (string | number | null)[]): string {
  return values.map(esc).join(",");
}

export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const lines = [csvLine(headers)];
  for (const r of rows) lines.push(csvLine(r));
  return lines.join("\r\n");
}
