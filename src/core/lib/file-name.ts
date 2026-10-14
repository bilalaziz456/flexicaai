/**
 * How a saved or downloaded file is named — ONE rule for every document in the
 * patient section (owner's call, 2026-10-15):
 *
 *     test patient - Prescription - 15 Oct 2026 01-45 AM.pdf
 *
 * patient, then what it is, then when. A folder of downloads then sorts by patient and
 * reads without opening anything. Pure (no DB, no browser API), so the server's PDF
 * responses and the browser's print-to-PDF title use the very same words.
 */

/** "15 Oct 2026 01-45 AM": readable, and no ":" — not allowed in a Windows file name. */
export function fileStamp(d: Date = new Date()): string {
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const time = d
    .toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })
    .replace(":", "-");
  return `${date} ${time}`;
}

/** Drop the characters a file system refuses or mangles, and collapse spaces. */
export function cleanFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim();
}

/** "test patient - Prescription - 15 Oct 2026 01-45 AM" (no extension). */
export function patientFileName(patientName: string | null | undefined, section: string, at: Date = new Date()): string {
  const who = cleanFileName(patientName ?? "") || "Patient";
  return cleanFileName(`${who} - ${section} - ${fileStamp(at)}`);
}

/**
 * A `Content-Disposition` header that survives any name. A header must be Latin-1, so
 * an Urdu name would break a plain `filename="…"`; RFC 6266 carries the real name in
 * `filename*` (UTF-8) with an ASCII fallback for anything older.
 */
export function contentDisposition(kind: "inline" | "attachment", fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
