import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { BRAND_POWERED_BY } from "./brand";

/**
 * Prescription PDF generator — CORE, specialty-agnostic. It renders whatever
 * medication list it's given ({drug, dosage, duration}); it does not know dental
 * from derma. The clinic's MODULE produced and validated the drugs upstream
 * (CLAUDE.md §8); this only lays them out.
 *
 * Uses pdf-lib's built-in Helvetica (WinAnsi) — no font files to bundle, which
 * is what makes it reliable under Turbopack. Dynamic text is sanitised to ASCII
 * so a name/drug outside WinAnsi can never throw an encode error (a Unicode font
 * can be embedded later if non-Latin names become common).
 */

export type RxItem = {
  drug: string;
  dosage?: string | null;
  duration?: string | null;
};

export type PrescriptionInput = {
  clinicName: string;
  patientName: string;
  patientMrn?: string | null;
  doctorName?: string | null;
  date: Date;
  diagnosis?: string | null;
  items: RxItem[];
  advice?: string[];
};

const NAVY = rgb(8 / 255, 41 / 255, 87 / 255);
const TEAL = rgb(15 / 255, 180 / 255, 187 / 255);
const INK = rgb(0.12, 0.12, 0.12);
const MUTED = rgb(0.42, 0.42, 0.42);

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 50;
const CONTENT_W = PAGE_W - MARGIN * 2;

/** Keep text WinAnsi-safe (Helvetica can't encode arbitrary Unicode). */
const safe = (v: unknown): string =>
  String(v ?? "").replace(/[^\x20-\x7E]/g, "?");

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = safe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export async function generatePrescriptionPdf(
  input: PrescriptionInput,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Prescription - ${safe(input.patientName)}`);
  doc.setProducer("FlexicaAI");

  const page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let y = PAGE_H - MARGIN;

  const text = (
    s: string,
    x: number,
    yy: number,
    opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {},
  ) =>
    page.drawText(safe(s), {
      x,
      y: yy,
      size: opts.size ?? 11,
      font: opts.font ?? reg,
      color: opts.color ?? INK,
    });

  const rightText = (
    s: string,
    yy: number,
    opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {},
  ) => {
    const font = opts.font ?? reg;
    const size = opts.size ?? 11;
    const w = font.widthOfTextAtSize(safe(s), size);
    text(s, PAGE_W - MARGIN - w, yy, opts);
  };

  // ---- Header ----
  text(input.clinicName, MARGIN, y - 18, { font: bold, size: 20, color: NAVY });
  rightText("PRESCRIPTION", y - 16, { font: bold, size: 12, color: TEAL });
  y -= 30;
  page.drawRectangle({ x: MARGIN, y, width: CONTENT_W, height: 2, color: NAVY });
  y -= 26;

  // ---- Patient + date ----
  text("PATIENT", MARGIN, y, { font: bold, size: 8, color: MUTED });
  rightText(
    input.date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    y,
    { size: 10, color: MUTED },
  );
  y -= 15;
  text(input.patientName, MARGIN, y, { font: bold, size: 13, color: INK });
  y -= 18;
  // MRN on its own labelled line under the name (omitted when the patient has none).
  if (input.patientMrn) {
    text(`MRN#: ${input.patientMrn}`, MARGIN, y, { size: 10, color: MUTED });
    y -= 16;
  }
  if (input.doctorName) {
    text(`Prescribed by: Dr. ${input.doctorName}`, MARGIN, y, {
      size: 10,
      color: MUTED,
    });
    y -= 20;
  }

  if (input.diagnosis) {
    y -= 4;
    text("DIAGNOSIS", MARGIN, y, { font: bold, size: 8, color: MUTED });
    y -= 14;
    for (const line of wrap(input.diagnosis, reg, 11, CONTENT_W)) {
      text(line, MARGIN, y, { size: 11 });
      y -= 15;
    }
    y -= 4;
  }

  // ---- Rx list ----
  y -= 8;
  text("Rx", MARGIN, y, { font: bold, size: 18, color: NAVY });
  y -= 22;

  if (input.items.length === 0) {
    text("No medications prescribed.", MARGIN + 6, y, { size: 11, color: MUTED });
    y -= 18;
  } else {
    input.items.forEach((item, i) => {
      const head = `${i + 1}.  ${item.drug}`;
      text(head, MARGIN + 6, y, { font: bold, size: 12 });
      y -= 16;
      const detail = [item.dosage, item.duration]
        .map((s) => safe(s ?? "").trim())
        .filter(Boolean)
        .join("  -  ");
      if (detail) {
        for (const line of wrap(detail, reg, 10.5, CONTENT_W - 24)) {
          text(line, MARGIN + 24, y, { size: 10.5, color: MUTED });
          y -= 14;
        }
      }
      y -= 8;
    });
  }

  // ---- Advice ----
  if (input.advice && input.advice.length > 0) {
    y -= 6;
    text("ADVICE", MARGIN, y, { font: bold, size: 8, color: MUTED });
    y -= 15;
    for (const note of input.advice) {
      for (const line of wrap(`- ${note}`, reg, 10.5, CONTENT_W)) {
        text(line, MARGIN + 6, y, { size: 10.5 });
        y -= 14;
      }
    }
  }

  // ---- Footer / signature ----
  const footY = MARGIN + 60;
  page.drawLine({
    start: { x: PAGE_W - MARGIN - 180, y: footY },
    end: { x: PAGE_W - MARGIN, y: footY },
    thickness: 0.75,
    color: MUTED,
  });
  rightText("Doctor's signature", footY - 12, { size: 9, color: MUTED });

  page.drawLine({
    start: { x: MARGIN, y: MARGIN + 26 },
    end: { x: PAGE_W - MARGIN, y: MARGIN + 26 },
    thickness: 0.5,
    color: rgb(0.85, 0.85, 0.85),
  });
  text(
    "This prescription was generated with FlexicaAI. Review by the prescribing doctor.",
    MARGIN,
    MARGIN + 14,
    { size: 8, color: MUTED },
  );
  // Brand credit, centered on the last line.
  const brand = safe(BRAND_POWERED_BY);
  const brandW = reg.widthOfTextAtSize(brand, 8);
  text(brand, (PAGE_W - brandW) / 2, MARGIN + 2, { size: 8, color: MUTED });

  return doc.save();
}
