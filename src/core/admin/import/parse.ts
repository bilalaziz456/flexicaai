import "server-only";

import ExcelJS from "exceljs";

/**
 * Import file parsing — CORE. Turns an uploaded CSV or `.xlsx` into rows keyed by a
 * NORMALISED header (trimmed, lowercased, spaces → underscores), so both formats feed
 * the identical validation path. The first non-empty row is the header. See
 * docs/import-plan.md.
 */
export type ImportRow = Record<string, string>;

const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function normHeader(h: string): string {
  return String(h ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

function rowsFromMatrix(matrix: string[][]): { rows: ImportRow[]; headers: string[] } {
  const nonEmpty = matrix.filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  if (nonEmpty.length === 0) return { rows: [], headers: [] };
  const headers = nonEmpty[0].map(normHeader);
  const rows: ImportRow[] = [];
  for (let i = 1; i < nonEmpty.length; i++) {
    const row: ImportRow = {};
    headers.forEach((h, idx) => {
      if (h) row[h] = String(nonEmpty[i][idx] ?? "").trim();
    });
    rows.push(row);
  }
  return { rows, headers: headers.filter(Boolean) };
}

/** RFC-4180 CSV parser (handles quotes, embedded commas/newlines, BOM). No dependency. */
export function parseCsv(text: string): { rows: ImportRow[]; headers: string[] } {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const matrix: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\r") {
      /* handled by the following \n */
    } else if (c === "\n") {
      record.push(field);
      matrix.push(record);
      record = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    matrix.push(record);
  }
  return rowsFromMatrix(matrix);
}

function cellText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return isoDate(v);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((t) => t.text ?? "").join("").trim();
    if (typeof o.text === "string") return o.text.trim(); // hyperlink / rich cell
    if ("result" in o) return String(o.result ?? "").trim(); // formula
    return "";
  }
  return String(v).trim();
}

/** Parse the first worksheet of an `.xlsx` into rows. */
export async function parseXlsx(buf: ArrayBuffer): Promise<{ rows: ImportRow[]; headers: string[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], headers: [] };
  const matrix: string[][] = [];
  ws.eachRow((row) => {
    const vals = row.values as unknown[]; // 1-indexed (index 0 is empty)
    const cells: string[] = [];
    for (let i = 1; i < vals.length; i++) cells.push(cellText(vals[i]));
    matrix.push(cells);
  });
  return rowsFromMatrix(matrix);
}

/** Dispatch by filename extension; default to CSV. */
export async function parseImportFile(
  filename: string,
  buf: ArrayBuffer,
): Promise<{ rows: ImportRow[]; headers: string[] }> {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "xlsx" || ext === "xls") return parseXlsx(buf);
  return parseCsv(new TextDecoder("utf-8").decode(buf));
}

/** First non-empty value among candidate (already-normalised) header names. */
export function pick(row: ImportRow, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}
