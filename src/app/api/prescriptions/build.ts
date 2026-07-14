import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { notDeleted } from "@/core/db/tenant";
import { clinics, patients, users, visits } from "@/core/db/schema";
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
      clinicName: clinics.name,
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
    doctorName: row.doctorName,
    date: row.visitDate,
    diagnosis,
    items,
    advice,
  });

  const nameSlug = row.patientName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const phoneSlug = (row.patientPhone ?? "").replace(/[^0-9]/g, "");
  const filename = `prescription-${nameSlug}${phoneSlug ? `-${phoneSlug}` : ""}.pdf`;

  return { ok: true, pdf, filename, clinicId: row.clinicId };
}
