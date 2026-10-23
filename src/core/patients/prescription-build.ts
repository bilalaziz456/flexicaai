import "server-only";
import { patientFileName } from "@/core/lib/file-name";

import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { notDeleted } from "@/core/db/tenant";
import { clinics, patients, prescriptions, users, visits } from "@/core/db/schema";
import { unscoped } from "@/core/db/tenant-guard";
import { buildLetterheadPrescriptionPdf } from "@/core/clinics/letterhead";
import {
  generatePrescriptionPdf,
  type RxItem,
} from "@/core/lib/prescription-pdf";

/**
 * Fetches an APPROVED visit and renders its prescription PDF. App-level (not
 * /core) because it reads the visit note shape. Auth is the CALLER's job: the
 * authed route checks the clinic; the public link route trusts its signed token.
 * Returns the clinic id so the authed route can enforce tenant isolation.
 */
export async function buildPrescriptionPdf(
  visitId: string,
): Promise<
  | { ok: true; pdf: Uint8Array; filename: string; clinicId: string }
  | { ok: false; status: number; error: string }
> {
  const [row] = await db
    .select({
      clinicId: visits.clinicId,
      status: visits.status,
      note: visits.note,
      visitDate: visits.visitDate,
      patientName: patients.fullName,
      patientPhone: patients.phone,
      patientMrn: patients.mrn,
      patientMrnLabel: patients.mrnLabel,
      patientCreatedAt: patients.createdAt,
      clinicName: clinics.name,
      mrnPrefix: clinics.mrnPrefix,
      doctorName: users.fullName,
    })
    .from(visits)
    .innerJoin(patients, eq(visits.patientId, patients.id))
    .innerJoin(clinics, eq(visits.clinicId, clinics.id))
    .leftJoin(users, eq(visits.doctorId, users.id))
    .where(and(eq(visits.id, visitId), notDeleted(visits.deletedAt)))
    .limit(1);

  if (!row) return { ok: false, status: 404, error: "Not found." };
  if (row.status !== "approved") {
    return {
      ok: false,
      status: 400,
      error: "Approve the visit before generating a prescription.",
    };
  }

  const note = (row.note ?? {}) as Record<string, unknown>;
  const items: RxItem[] = (
    Array.isArray(note.prescriptions)
      ? (note.prescriptions as Record<string, unknown>[])
      : []
  )
    .map((p) => ({
      drug: typeof p.drug === "string" ? p.drug : "",
      dosage: typeof p.dosage === "string" ? p.dosage : null,
      duration: typeof p.duration === "string" ? p.duration : null,
    }))
    .filter((p) => p.drug.trim().length > 0);

  const diagnosis = typeof note.diagnosis === "string" ? note.diagnosis : null;
  const advice = Array.isArray(note.treatmentPlan)
    ? (note.treatmentPlan as unknown[]).filter(
        (s): s is string => typeof s === "string",
      )
    : undefined;

  const pdf = await generatePrescriptionPdf({
    clinicName: row.clinicName,
    patientName: row.patientName,
    patientMrn: row.patientMrnLabel,
    doctorName: row.doctorName,
    date: row.visitDate,
    diagnosis,
    items,
    advice,
  });

  // The one patient-file naming rule (core/lib/file-name.ts). The phone number used to
  // be in the name — personal data in a file that gets forwarded on WhatsApp.
  const filename = `${patientFileName(row.patientName, "Prescription")}.pdf`;

  return { ok: true, pdf, filename, clinicId: row.clinicId };
}

/**
 * A visit's prescription as it stands NOW (owner's report, 2026-10-24): when the
 * note's medicines became a prescription (migration 0135) and someone edited it, the
 * Voice scribe's Prescription button and the WhatsApp link were still rebuilding the
 * PDF from the signed note, so the edit never printed. Now:
 *   - a linked prescription → that one, with every edit, on the clinic's letterhead
 *     (the same PDF as Print with letterhead on the patient's page);
 *   - a linked one that was DELETED → refused, never the note's copy in its place;
 *   - none (a note older than any prescription) → the note's PDF, as before.
 * Not clinic-scoped by itself — the WhatsApp link has no session, so the callers check
 * the clinic (the staff route compares it; the public token IS the authorization).
 */
export async function buildVisitPrescriptionPdf(
  visitId: string,
  /** `pad`: only the writing, for paper with the letterhead already printed on it. */
  opts: { pad?: boolean } = {},
): Promise<
  | { ok: true; pdf: Uint8Array; filename: string; clinicId: string }
  | { ok: false; status: number; error: string }
> {
  const linked = await unscoped("a visit's prescription, for staff or a signed link", () =>
    db
      .select({ id: prescriptions.id, clinicId: prescriptions.clinicId, deletedAt: prescriptions.deletedAt })
      .from(prescriptions)
      .where(eq(prescriptions.visitId, visitId))
      .limit(1),
  );
  const rx = linked[0];
  if (!rx) return buildPrescriptionPdf(visitId);
  if (rx.deletedAt) return { ok: false, status: 404, error: "This prescription was deleted." };
  const out = await buildLetterheadPrescriptionPdf(rx.clinicId, rx.id, { pad: opts.pad });
  if (!out) return { ok: false, status: 404, error: "Not found." };
  return { ok: true, pdf: out.pdf, filename: out.filename, clinicId: rx.clinicId };
}
