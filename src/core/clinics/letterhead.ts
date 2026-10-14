import "server-only";
import { patientFileName } from "@/core/lib/file-name";

import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";
import { readFileByKey } from "@/core/integrations/storage";
import { report } from "@/core/observability";
import { ageFromDob } from "@/core/lib/age";
import { displayStaffName } from "@/core/types/auth";
import { describePrescriptionItem, type PrescriptionItem } from "@/core/lib/prescription-items";
import {
  generateLetterheadPrescriptionPdf,
  type LetterheadSource,
  type Margins,
  type RxPrintLine,
} from "@/core/lib/letterhead-pdf";
import { getPrescriptionForPrint } from "@/core/patients/prescriptions";

/**
 * The clinic's LETTERHEAD (owner's call, 2026-10-14): a blank A4 page, uploaded by the
 * account manager as a PDF or image, and four margins saying where the writing goes.
 * Every clinic's design is different, so the page itself is the template.
 */

/** What a letterhead file may be, and the storage extension for each. */
export const LETTERHEAD_MIME_EXT: Readonly<Record<string, string>> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
};
export const MAX_LETTERHEAD_BYTES = 5 * 1024 * 1024;

export type LetterheadSettings = {
  key: string | null;
  margins: Margins;
  printDoctorName: boolean;
  clinicName: string;
  address: string | null;
  phone: string | null;
};

export async function getLetterheadSettings(clinicId: string): Promise<LetterheadSettings | null> {
  const [c] = await db
    .select({
      key: clinics.letterheadKey,
      top: clinics.letterheadTopMm,
      bottom: clinics.letterheadBottomMm,
      left: clinics.letterheadLeftMm,
      right: clinics.letterheadRightMm,
      printDoctorName: clinics.rxPrintDoctorName,
      name: clinics.name,
      address: clinics.publicAddress,
      phone: clinics.whatsappDisplayNumber,
    })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  if (!c) return null;
  return {
    key: c.key,
    margins: { topMm: c.top, bottomMm: c.bottom, leftMm: c.left, rightMm: c.right },
    printDoctorName: c.printDoctorName,
    clinicName: c.name,
    address: c.address,
    phone: c.phone,
  };
}

/** The stored letterhead's bytes, or null (none, or unreadable — reported, never fatal). */
export async function loadLetterhead(clinicId: string, key: string | null): Promise<LetterheadSource | null> {
  if (!key) return null;
  const ext = key.split(".").pop()?.toLowerCase();
  const kind = ext === "pdf" ? "pdf" : ext === "png" ? "png" : ext === "jpg" || ext === "jpeg" ? "jpg" : null;
  if (!kind) return null;
  try {
    return { bytes: new Uint8Array(await readFileByKey(key)), kind };
  } catch (e) {
    // The prescription still prints, on the plain header — but a clinic whose
    // letterhead silently vanished must be noticed.
    report(e, { op: "letterhead.read", severity: "warn", clinicId });
    return null;
  }
}

export const rxLines = (items: PrescriptionItem[]): RxPrintLine[] =>
  items.map((it) => ({
    name: it.name,
    dose: it.dose ?? null,
    detail: describePrescriptionItem(it) || null,
    note: it.note ?? null,
  }));

/** A typed prescription as a PDF on the clinic's letterhead (or for its pre-printed pad). */
export async function buildLetterheadPrescriptionPdf(
  clinicId: string,
  prescriptionId: string,
  opts: { pad?: boolean } = {},
): Promise<{ pdf: Uint8Array; filename: string } | null> {
  const [row, settings] = await Promise.all([
    getPrescriptionForPrint(clinicId, prescriptionId),
    getLetterheadSettings(clinicId),
  ]);
  if (!row || !settings) return null;
  const p = row.prescription;
  const age = ageFromDob(row.patientDob);
  const ageGender = [age !== null ? `${age} yrs` : null, row.patientGender].filter(Boolean).join(" / ") || null;
  const pdf = await generateLetterheadPrescriptionPdf({
    letterhead: opts.pad ? null : await loadLetterhead(clinicId, settings.key),
    margins: settings.margins,
    pad: opts.pad,
    clinic: { name: settings.clinicName, address: settings.address, phone: settings.phone },
    patient: { name: row.patientName, mrn: row.patientMrn, ageGender },
    date: new Date(`${p.prescribedOn}T12:00:00`),
    doctorName: p.printDoctorName && p.doctorName ? displayStaffName(row.doctorPrefix, p.doctorName) : null,
    items: rxLines(p.items),
    notes: p.notes,
  });
  return { pdf, filename: `${patientFileName(row.patientName, "Prescription")}.pdf` };
}

/**
 * A SAMPLE prescription on the clinic's letterhead with the given margins — the account
 * manager's live preview while setting the margins up, before anything is saved.
 */
export async function buildLetterheadPreviewPdf(clinicId: string, margins: Margins): Promise<Uint8Array | null> {
  const settings = await getLetterheadSettings(clinicId);
  if (!settings) return null;
  return generateLetterheadPrescriptionPdf({
    letterhead: await loadLetterhead(clinicId, settings.key),
    margins,
    clinic: { name: settings.clinicName, address: settings.address, phone: settings.phone },
    patient: { name: "Sample Patient", mrn: "FA-100001", ageGender: "34 yrs / Female" },
    date: new Date(),
    doctorName: "Dr. Sample Doctor",
    items: rxLines([
      { name: "Augmentin", dose: "625 mg", form: "oral", frequency: "bd", durationValue: 5, durationUnit: "days" },
      { name: "Brufen", dose: "400 mg", form: "oral", frequency: "tds", durationValue: 3, durationUnit: "days" },
      { name: "Chlorhexidine mouthwash", dose: "10 ml", form: "other", frequency: "bd", durationValue: 1, durationUnit: "weeks" },
    ]),
    notes: "Take after meals. Review in one week.",
  });
}
