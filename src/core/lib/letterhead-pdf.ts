import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFEmbeddedPage, type PDFImage } from "pdf-lib";

/**
 * Documents printed ON the clinic's own letterhead — a prescription (owner's call,
 * 2026-10-14) and a treatment estimate (2026-10-18) —
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
  // The minus sign (U+2212) used in money figures is not in WinAnsi; a hyphen reads the same.
  String(v ?? "").replace(/−/g, "-").replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”•…]/g, "?");

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

type TextOpts = { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> };

/**
 * A document on the clinic's letterhead, ready to write into: the background drawn on
 * every page (or the plain header, or nothing on a pad), the writing box the margins
 * leave, and a cursor `y` that moves down it, starting a new page when it runs out.
 * Shared by every letterhead document, so a prescription and an estimate sit in the
 * same box on the same page.
 */
async function openLetterhead(o: {
  letterhead: LetterheadSource | null;
  margins: Margins;
  pad?: boolean;
  clinic: { name: string; address?: string | null; phone?: string | null };
  title: string;
}) {
  const doc = await PDFDocument.create();
  doc.setTitle(safe(o.title));
  doc.setProducer("FlexicaAI");
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // The background, embedded ONCE and drawn on every page.
  let bgPage: PDFEmbeddedPage | null = null;
  let bgImage: PDFImage | null = null;
  if (o.letterhead && !o.pad) {
    try {
      if (o.letterhead.kind === "pdf") [bgPage] = await doc.embedPdf(o.letterhead.bytes, [0]);
      else if (o.letterhead.kind === "png") bgImage = await doc.embedPng(o.letterhead.bytes);
      else bgImage = await doc.embedJpg(o.letterhead.bytes);
    } catch {
      // An unreadable letterhead must not stop a document from printing; the plain
      // header is used instead (the caller reports the broken file).
      bgPage = null;
      bgImage = null;
    }
  }
  // With no letterhead (and not on a pad) a plain header takes the top of the page.
  const plainHeader = !bgPage && !bgImage && !o.pad;

  const m = clampMargins(o.margins);
  const left = m.leftMm * MM;
  const right = A4_W - m.rightMm * MM;
  const top = A4_H - m.topMm * MM;
  const bottom = m.bottomMm * MM;
  const width = right - left;

  let page: PDFPage | null = null;
  const c = {
    doc,
    reg,
    bold,
    left,
    right,
    top,
    bottom,
    width,
    /** Where the next line goes; moves DOWN the page. */
    y: top,
    page(): PDFPage {
      return page!;
    },
    text(s: string, x: number, yy: number, t: TextOpts = {}) {
      page!.drawText(safe(s), { x, y: yy, size: t.size ?? 11, font: t.font ?? reg, color: t.color ?? INK });
    },
    rightText(s: string, yy: number, t: TextOpts = {}) {
      const f = t.font ?? reg;
      c.text(s, right - f.widthOfTextAtSize(safe(s), t.size ?? 11), yy, t);
    },
    rule(yy: number, thickness = 0.5) {
      page!.drawLine({ start: { x: left, y: yy }, end: { x: right, y: yy }, thickness, color: thickness >= 1 ? INK : RULE });
    },
    newPage() {
      page = doc.addPage([A4_W, A4_H]);
      if (bgPage) page.drawPage(bgPage, { x: 0, y: 0, width: A4_W, height: A4_H });
      if (bgImage) {
        // Fitted to the page width and laid from the top: an A4 scan fills the page
        // exactly, and anything else keeps its proportions rather than being stretched.
        const scale = A4_W / bgImage.width;
        const h = bgImage.height * scale;
        page.drawImage(bgImage, { x: 0, y: A4_H - h, width: A4_W, height: h });
      }
      c.y = top;
      if (plainHeader) {
        // Within the top margin, above the writing box.
        const hy = A4_H - 18 * MM;
        c.text(o.clinic.name, left, hy, { font: bold, size: 18 });
        const sub = [o.clinic.address, o.clinic.phone].filter(Boolean).join("  |  ");
        if (sub) {
          let ly = hy - 16;
          for (const line of wrap(sub, reg, 9.5, width)) {
            c.text(line, left, ly, { size: 9.5, color: MUTED });
            ly -= 12;
          }
        }
        c.rule(top + 8, 1);
      }
    },
    /** Start a new page unless `h` more points fit above the bottom margin. */
    need(h: number) {
      if (c.y - h < bottom) c.newPage();
    },
    /** The patient line and the date — the same opening on every document. */
    patientBlock(patient: { name: string; mrn?: string | null; ageGender?: string | null }, date: Date) {
      c.y -= 12;
      c.text(`Patient: ${patient.name}`, left, c.y, { font: bold, size: 11.5 });
      c.rightText(date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }), c.y, { size: 10.5, color: MUTED });
      c.y -= 15;
      const meta = [patient.mrn ? `MRN: ${patient.mrn}` : null, patient.ageGender].filter(Boolean).join("   ");
      if (meta) {
        c.text(meta, left, c.y, { size: 9.5, color: MUTED });
        c.y -= 12;
      }
      c.rule(c.y - 2);
      c.y -= 24;
    },
  };
  c.newPage();
  return c;
}

export async function generateLetterheadPrescriptionPdf(input: LetterheadPrescriptionInput): Promise<Uint8Array> {
  const c = await openLetterhead({ ...input, title: `Prescription - ${input.patient.name}` });
  const { reg, bold, left, width } = c;
  // Room for the "By Dr. …" line, kept free at the foot of the LAST page.
  const signatureSpace = input.doctorName ? 28 : 0;

  c.patientBlock(input.patient, input.date);

  // ---- Rx ----
  c.text("Rx", left, c.y, { font: bold, size: 16 });
  c.y -= 22;
  if (input.items.length === 0) {
    c.text("No medicines.", left + 6, c.y, { size: 11, color: MUTED });
    c.y -= 16;
  }
  input.items.forEach((it, i) => {
    const head = `${i + 1}.  ${it.name}${it.dose ? `  ${it.dose}` : ""}`;
    const headLines = wrap(head, bold, 11.5, width - 6);
    const detailLines = it.detail ? wrap(it.detail, reg, 10, width - 22) : [];
    const noteLines = it.note ? wrap(it.note, reg, 10, width - 22) : [];
    c.need(headLines.length * 15 + (detailLines.length + noteLines.length) * 13 + 8);
    for (const l of headLines) {
      c.text(l, left + 6, c.y, { font: bold, size: 11.5 });
      c.y -= 15;
    }
    for (const l of detailLines) {
      c.text(l, left + 22, c.y, { size: 10, color: MUTED });
      c.y -= 13;
    }
    for (const l of noteLines) {
      c.text(l, left + 22, c.y, { size: 10, color: INK });
      c.y -= 13;
    }
    c.y -= 8;
  });

  // ---- Notes ----
  if (input.notes && input.notes.trim()) {
    const lines = wrap(input.notes, reg, 10.5, width);
    c.need(30);
    c.y -= 4;
    c.text("Notes", left, c.y, { font: bold, size: 10.5 });
    c.y -= 15;
    for (const l of lines) {
      c.need(14);
      c.text(l, left, c.y, { size: 10.5 });
      c.y -= 14;
    }
  }

  // ---- "By Dr. …", at the foot of the box ----
  // A credit, not a signature line (owner's call, 2026-10-18): a typed prescription is
  // entered at the desk, so a "Signature" line asked for one nobody was going to add.
  if (input.doctorName) {
    if (c.y - signatureSpace < c.bottom) c.newPage();
    c.rightText(`By ${input.doctorName}`, c.bottom + 10, { font: bold, size: 10.5 });
  }

  return c.doc.save();
}

/** One line of a treatment estimate, already priced (`core/patients/plan-bill.ts`). */
export type EstimatePrintLine = {
  name: string;
  /** Teeth, status — the grey line under the name. */
  detail?: string | null;
  /** "Clinic offer: 10% off (−Rs 1,000)", "Discount: Rs 500 (−Rs 500)". */
  adjustments?: string[];
  quantity: number;
  /** What the line costs, after its offer and discount. */
  amount: string;
  /** The price before them, shown struck through when it differs. */
  gross?: string | null;
};

export type LetterheadEstimateInput = {
  letterhead: LetterheadSource | null;
  margins: Margins;
  pad?: boolean;
  clinic: { name: string; address?: string | null; phone?: string | null };
  patient: { name: string; mrn?: string | null; ageGender?: string | null };
  date: Date;
  title: string;
  lines: EstimatePrintLine[];
  /** Label → amount, e.g. ["Subtotal", "Rs 28,000"], ["Overall discount", "−Rs 2,000"]. */
  totals: [string, string][];
  /** "Discount by Dr. Sana Ali and Smile Dental" — null when the plan gives none. */
  discountBy: string | null;
  total: string;
  note?: string | null;
};

/**
 * A treatment plan's ESTIMATE on the clinic's letterhead (owner's call, 2026-10-18) —
 * the same page, box and pad mode as a prescription. The figures arrive formatted: the
 * money is worked out once, by `computePlanBill`, and this only lays it out.
 */
export async function generateLetterheadEstimatePdf(input: LetterheadEstimateInput): Promise<Uint8Array> {
  const c = await openLetterhead({ ...input, title: `Treatment estimate - ${input.patient.name}` });
  const { reg, bold, left, right, width } = c;
  const qtyX = right - 110;

  c.patientBlock(input.patient, input.date);

  c.text("Treatment estimate", left, c.y, { font: bold, size: 15 });
  c.y -= 16;
  for (const l of wrap(input.title, reg, 10.5, width)) {
    c.text(l, left, c.y, { size: 10.5, color: MUTED });
    c.y -= 13;
  }
  c.y -= 8;

  // Column heads.
  c.text("Treatment", left, c.y, { size: 9, color: MUTED });
  c.text("Qty", qtyX, c.y, { size: 9, color: MUTED });
  c.rightText("Amount", c.y, { size: 9, color: MUTED });
  c.y -= 6;
  c.rule(c.y);
  c.y -= 14;

  if (input.lines.length === 0) {
    c.text("No treatments on this plan.", left, c.y, { size: 10.5, color: MUTED });
    c.y -= 16;
  }
  for (const line of input.lines) {
    const nameLines = wrap(line.name, bold, 11, qtyX - left - 10);
    const detailLines = line.detail ? wrap(line.detail, reg, 9.5, qtyX - left - 10) : [];
    const adj = (line.adjustments ?? []).flatMap((a) => wrap(a, reg, 9.5, qtyX - left - 10));
    c.need(nameLines.length * 14 + (detailLines.length + adj.length) * 12 + (line.gross ? 12 : 0) + 8);
    const rowTop = c.y;
    if (line.gross) {
      c.rightText(line.gross, rowTop, { size: 9, color: MUTED });
      // Struck through: what the line would have cost without its offer or discount.
      const w = reg.widthOfTextAtSize(safe(line.gross), 9);
      c.page().drawLine({ start: { x: right - w, y: rowTop + 3 }, end: { x: right, y: rowTop + 3 }, thickness: 0.6, color: MUTED });
    }
    c.text(String(line.quantity), qtyX, rowTop, { size: 10.5 });
    c.rightText(line.amount, line.gross ? rowTop - 12 : rowTop, { font: bold, size: 10.5 });
    for (const l of nameLines) {
      c.text(l, left, c.y, { font: bold, size: 11 });
      c.y -= 14;
    }
    for (const l of detailLines) {
      c.text(l, left + 8, c.y, { size: 9.5, color: MUTED });
      c.y -= 12;
    }
    for (const l of adj) {
      c.text(l, left + 8, c.y, { size: 9.5, color: MUTED });
      c.y -= 12;
    }
    if (line.gross && c.y > rowTop - 24) c.y = rowTop - 24;
    c.y -= 6;
  }

  // ---- Totals ----
  c.need(input.totals.length * 14 + (input.discountBy ? 14 : 0) + 34);
  c.rule(c.y + 6);
  c.y -= 8;
  for (const [label, value] of input.totals) {
    c.text(label, qtyX - 120, c.y, { size: 10, color: MUTED });
    c.rightText(value, c.y, { size: 10 });
    c.y -= 14;
  }
  if (input.discountBy) {
    c.text(input.discountBy, qtyX - 120, c.y, { font: bold, size: 9.5 });
    c.y -= 14;
  }
  c.y -= 2;
  c.text("Estimated total", qtyX - 120, c.y, { font: bold, size: 12 });
  c.rightText(input.total, c.y, { font: bold, size: 12 });
  c.y -= 22;

  if (input.note && input.note.trim()) {
    for (const l of wrap(input.note, reg, 10, width)) {
      c.need(13);
      c.text(l, left, c.y, { size: 10 });
      c.y -= 13;
    }
    c.y -= 6;
  }
  c.need(14);
  c.text("This is an estimate. The final cost may vary with treatment.", left, c.y, { size: 8.5, color: MUTED });

  return c.doc.save();
}
