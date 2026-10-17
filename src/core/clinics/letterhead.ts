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
  generateLetterheadEstimatePdf,
  generateLetterheadPrescriptionPdf,
  type LetterheadSource,
  type Margins,
  type RxPrintLine,
} from "@/core/lib/letterhead-pdf";
import { getPrescriptionForPrint } from "@/core/patients/prescriptions";
import { getTreatmentPlan, listTreatmentPlanItems, planBillOf } from "@/core/patients/treatment-plans";
import { getPatientHeader } from "@/core/patients/list";
import { discountByLabel } from "@/core/patients/plan-bill";
import { describeOfferAmount, offerLabel } from "@/core/appointments/procedure-offer";
import { formatPkr } from "@/core/appointments/fee";
import { vocabularyLabel } from "@/core/db/vocabulary-cache";

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
    // Always "By Dr. …" when a doctor is chosen (owner's call, 2026-10-18). It used to be a
    // per-prescription tick defaulting to a clinic setting, and an unticked box printed a
    // prescription with no doctor on it at all. The `print_doctor_name` columns are no longer read.
    doctorName: p.doctorName ? displayStaffName(row.doctorPrefix, p.doctorName) : null,
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

/**
 * A treatment plan's ESTIMATE as a PDF on the clinic's letterhead (owner's call,
 * 2026-10-18), or for its pre-printed pad — the same figures as the on-screen estimate,
 * both from `planBillOf`. Clinic-scoped: the plan and its patient must be this clinic's.
 */
export async function buildLetterheadEstimatePdf(
  clinicId: string,
  planId: string,
  opts: { pad?: boolean } = {},
): Promise<{ pdf: Uint8Array; filename: string } | null> {
  const [plan, settings] = await Promise.all([getTreatmentPlan(clinicId, planId), getLetterheadSettings(clinicId)]);
  if (!plan || !settings) return null;
  const [items, patient] = await Promise.all([
    listTreatmentPlanItems(clinicId, planId),
    getPatientHeader(clinicId, plan.patientId),
  ]);
  if (!patient) return null;

  const bill = planBillOf(plan, items);
  const offerName = offerLabel(settings.clinicName);
  const lines = items.map((it, i) => {
    const b = bill.items[i];
    const cancelled = it.status === "cancelled";
    return {
      name: it.name,
      detail:
        [
          it.tooth ? `${it.tooth.includes(",") ? "Teeth" : "Tooth"} ${it.tooth}` : null,
          vocabularyLabel("treatment_item_statuses", it.status),
        ]
          .filter(Boolean)
          .join(" · ") || null,
      adjustments: [
        b.offer > 0 ? `${offerName}: ${describeOfferAmount(it.offerType, it.offerValue)} (−${formatPkr(b.offer)})` : null,
        b.discount > 0 ? `Discount: ${describeOfferAmount(it.discountType, it.discountValue)} (−${formatPkr(b.discount)})` : null,
      ].filter((v): v is string => Boolean(v)),
      quantity: it.quantity,
      // A cancelled item shows its price but costs nothing (computePlanBill).
      amount: formatPkr(cancelled ? it.unitPrice * it.quantity : b.net),
      gross: !cancelled && b.net !== b.gross ? formatPkr(b.gross) : null,
    };
  });
  const discounted = bill.offers > 0 || bill.planDiscount > 0;
  const totals: [string, string][] = [];
  if (discounted) totals.push(["Subtotal", formatPkr(bill.gross)]);
  if (bill.offers > 0) totals.push([offerName, `−${formatPkr(bill.offers)}`]);
  if (bill.itemDiscounts > 0) totals.push(["Treatment discounts", `−${formatPkr(bill.itemDiscounts)}`]);
  if (bill.overallDiscount > 0) {
    totals.push([
      `Overall discount${plan.discountType === "percent" ? ` (${plan.discountValue}%)` : ""}`,
      `−${formatPkr(bill.overallDiscount)}`,
    ]);
  }

  const pdf = await generateLetterheadEstimatePdf({
    letterhead: opts.pad ? null : await loadLetterhead(clinicId, settings.key),
    margins: settings.margins,
    pad: opts.pad,
    clinic: { name: settings.clinicName, address: settings.address, phone: settings.phone },
    patient: { name: patient.fullName, mrn: patient.mrnLabel },
    date: plan.createdAt,
    title: plan.title,
    lines,
    totals,
    discountBy:
      bill.planDiscount > 0
        ? `Discount by ${discountByLabel(plan.discountBorneBy, plan.doctorName, settings.clinicName)}`
        : null,
    total: formatPkr(bill.total),
    note: plan.note,
  });
  return { pdf, filename: `${patientFileName(patient.fullName, "Treatment estimate")}.pdf` };
}
