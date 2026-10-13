import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFEmbeddedPage, type PDFImage } from "pdf-lib";

/**
 * A prescription printed ON the clinic's own letterhead (owner's call, 2026-10-14) —
 * CORE, specialty-agnostic: it lays out whatever lines it is given.
 *
 * Every clinic's letterhead is a different design — a tall header or a thin one, the
 * name on the left or the right, a footer with timings or none — so there is no
 * template. The account manager uploads the blank page (PDF or image) and sets four
 * margins; this draws that page as the BACKGROUND and writes only inside the box the
 * margins leave. Long prescriptions continue on another page with the same letterhead.
 *
 * `pad: true` leaves the background out and writes in exactly the same box — for a
 * clinic printing on its own pre-printed pads, so the writing lands where the blank
 * space is.
 *
 * Helvetica (WinAnsi) like the other generated PDFs: text outside it is replaced
 * rather than throwing (a Unicode font can be embedded later if needed).
 */

export type LetterheadSource = { bytes: Uint8Array; kind: "pdf" | "png" | "jpg" };
export type Margins = { topMm: number; bottomMm: number; leftMm: number; rightMm: number };

export type RxPrintLine = { name: string; dose?: string | null; detail?: string | null; note?: string | null };

export type LetterheadPrescriptionInput = {
  letterhead: LetterheadSource | null;
  margins: Margins;
  /** Print on the clinic's own pre-printed pad: the box only, no background. */
  pad?: boolean;
  /** Used for a plain header when the clinic has no letterhead uploaded. */
  clinic: { name: string; address?: string | null; phone?: string | null };
  patient: { name: string; mrn?: string | null; ageGender?: string | null };
  date: Date;
  /** Null = the doctor's name is not printed (the clinic's letterhead may carry it). */
  doctorName: string | null;
  items: RxPrintLine[];
  notes?: string | null;
};

export const A4_W = 595.28;
export const A4_H = 841.89;
const MM = 72 / 25.4;

const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.4, 0.4, 0.4);
const RULE = rgb(0.8, 0.8, 0.8);

/**
 * Keep text to what Helvetica (WinAnsi) can print. Latin-1 is in it — so "·" (the
 * separator in every medicine line), "½" ("½-0-½") and accented names survive — plus
 * the typographic dashes, quotes and bullet; anything else becomes "?" rather than
 * throwing mid-render.
 */
const safe = (v: unknown): string =>
  String(v ?? "").replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”•…]/g, "?");

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        out.push(line);
        line = w;
      } else line = test;
    }
    out.push(line);
  }
  return out.length ? out : [""];
}

/** Clamp margins to something that still leaves a usable box on A4. */
export function clampMargins(m: Margins): Margins {
  const c = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
  return { topMm: c(m.topMm, 150), bottomMm: c(m.bottomMm, 150), leftMm: c(m.leftMm, 60), rightMm: c(m.rightMm, 60) };
}

export async function generateLetterheadPrescriptionPdf(input: LetterheadPrescriptionInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Prescription - ${safe(input.patient.name)}`);
  doc.setProducer("FlexicaAI");
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // The background, embedded ONCE and drawn on every page.
  let bgPage: PDFEmbeddedPage | null = null;
  let bgImage: PDFImage | null = null;
  if (input.letterhead && !input.pad) {
    try {
      if (input.letterhead.kind === "pdf") [bgPage] = await doc.embedPdf(input.letterhead.bytes, [0]);
      else if (input.letterhead.kind === "png") bgImage = await doc.embedPng(input.letterhead.bytes);
      else bgImage = await doc.embedJpg(input.letterhead.bytes);
    } catch {
      // An unreadable letterhead must not stop a prescription from printing; the plain
      // header is used instead (the caller reports the broken file).
      bgPage = null;
      bgImage = null;
    }
  }
  const hasLetterhead = Boolean(bgPage || bgImage);
  // With no letterhead (and not on a pad) a plain header takes the top of the page.
  const plainHeader = !hasLetterhead && !input.pad;

  const m = clampMargins(input.margins);
  const left = m.leftMm * MM;
  const right = A4_W - m.rightMm * MM;
  const top = A4_H - m.topMm * MM;
  const bottom = m.bottomMm * MM;
  const width = right - left;

  let page: PDFPage;
  let y = 0;
  const newPage = () => {
    page = doc.addPage([A4_W, A4_H]);
    if (bgPage) page.drawPage(bgPage, { x: 0, y: 0, width: A4_W, height: A4_H });
    if (bgImage) {
      // Fitted to the page width and laid from the top: an A4 scan fills the page
      // exactly, and anything else keeps its proportions rather than being stretched.
      const scale = A4_W / bgImage.width;
      const h = bgImage.height * scale;
      page.drawImage(bgImage, { x: 0, y: A4_H - h, width: A4_W, height: h });
    }
    y = top;
    if (plainHeader) drawPlainHeader();
  };
  const text = (s: string, x: number, yy: number, o: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {}) =>
    page.drawText(safe(s), { x, y: yy, size: o.size ?? 11, font: o.font ?? reg, color: o.color ?? INK });
  const rightText = (s: string, yy: number, o: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {}) => {
    const f = o.font ?? reg;
    const size = o.size ?? 11;
    text(s, right - f.widthOfTextAtSize(safe(s), size), yy, o);
  };
  function drawPlainHeader() {
    // Within the top margin, above the writing box.
    const hy = A4_H - 18 * MM;
    text(input.clinic.name, left, hy, { font: bold, size: 18 });
    const sub = [input.clinic.address, input.clinic.phone].filter(Boolean).join("  |  ");
    if (sub) {
      let ly = hy - 16;
      for (const line of wrap(sub, reg, 9.5, width)) {
        text(line, left, ly, { size: 9.5, color: MUTED });
        ly -= 12;
      }
    }
    page.drawLine({ start: { x: left, y: top + 8 }, end: { x: right, y: top + 8 }, thickness: 1, color: INK });
  }
  // Room for the signature block, kept free at the foot of the LAST page.
  const signatureSpace = input.doctorName ? 52 : 0;
  const need = (h: number) => {
    if (y - h < bottom) newPage();
  };

  newPage();

  // ---- Patient + date ----
  y -= 12;
  text(`Patient: ${input.patient.name}`, left, y, { font: bold, size: 11.5 });
  rightText(input.date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }), y, { size: 10.5, color: MUTED });
  y -= 15;
  const meta = [input.patient.mrn ? `MRN: ${input.patient.mrn}` : null, input.patient.ageGender].filter(Boolean).join("   ");
  if (meta) {
    text(meta, left, y, { size: 9.5, color: MUTED });
    y -= 12;
  }
  page!.drawLine({ start: { x: left, y: y - 2 }, end: { x: right, y: y - 2 }, thickness: 0.5, color: RULE });
  y -= 24;

  // ---- Rx ----
  text("Rx", left, y, { font: bold, size: 16 });
  y -= 22;
  if (input.items.length === 0) {
    text("No medicines.", left + 6, y, { size: 11, color: MUTED });
    y -= 16;
  }
  input.items.forEach((it, i) => {
    const head = `${i + 1}.  ${it.name}${it.dose ? `  ${it.dose}` : ""}`;
    const headLines = wrap(head, bold, 11.5, width - 6);
    const detailLines = it.detail ? wrap(it.detail, reg, 10, width - 22) : [];
    const noteLines = it.note ? wrap(it.note, reg, 10, width - 22) : [];
    need(headLines.length * 15 + (detailLines.length + noteLines.length) * 13 + 8);
    for (const l of headLines) {
      text(l, left + 6, y, { font: bold, size: 11.5 });
      y -= 15;
    }
    for (const l of detailLines) {
      text(l, left + 22, y, { size: 10, color: MUTED });
      y -= 13;
    }
    for (const l of noteLines) {
      text(l, left + 22, y, { size: 10, color: INK });
      y -= 13;
    }
    y -= 8;
  });

  // ---- Notes ----
  if (input.notes && input.notes.trim()) {
    const lines = wrap(input.notes, reg, 10.5, width);
    need(30);
    y -= 4;
    text("Notes", left, y, { font: bold, size: 10.5 });
    y -= 15;
    for (const l of lines) {
      need(14);
      text(l, left, y, { size: 10.5 });
      y -= 14;
    }
  }

  // ---- Doctor's name + signature, at the foot of the box ----
  if (input.doctorName) {
    if (y - signatureSpace < bottom) newPage();
    const sy = bottom + 22;
    page!.drawLine({ start: { x: right - 170, y: sy + 14 }, end: { x: right, y: sy + 14 }, thickness: 0.75, color: MUTED });
    rightText(input.doctorName, sy, { font: bold, size: 10.5 });
    rightText("Signature", sy - 12, { size: 8.5, color: MUTED });
  }

  return doc.save();
}
