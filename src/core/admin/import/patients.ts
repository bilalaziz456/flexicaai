import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { clinics, importBatches, patients } from "@/core/db/schema";
import { dobFromAge } from "@/core/lib/age";
import { parseImportFile, pick, type ImportRow } from "./parse";
import {
  normalizePhone,
  parseAmount,
  parseImportDate,
  summarize,
  type ImportPreview,
  type ImportResult,
  type RowResult,
} from "./types";

type PatientInput = {
  fullName: string;
  phone: string | null;
  email: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  address: string | null;
  externalRef: string | null;
  reference: string | null;
  openingBalance: number;
  registeredAt: Date | null;
};

/** Validate + normalise ONE row (no DB / dedup here — that's the analyze pass). */
function validateRow(row: ImportRow): RowResult<PatientInput> {
  const fullName = pick(row, "full_name", "name", "patient_name", "patient");
  if (!fullName) return { kind: "error", reason: "Missing patient name" };
  const warnings: string[] = [];

  const rawPhone = pick(row, "phone", "mobile", "contact", "phone_number", "whatsapp", "cell");
  const { phone, valid } = normalizePhone(rawPhone);
  if (rawPhone && !valid) warnings.push(`Phone "${rawPhone}" doesn't look valid — imported as-is`);

  let dob: string | null = null;
  const rawDob = pick(row, "date_of_birth", "dob", "birth_date", "birthdate");
  const rawAge = pick(row, "age");
  if (rawDob) {
    dob = parseImportDate(rawDob);
    if (!dob) warnings.push(`Unrecognised date of birth "${rawDob}" — left blank`);
  } else if (rawAge) {
    const n = Number(rawAge);
    if (Number.isInteger(n) && n >= 0 && n <= 150) dob = dobFromAge(n);
    else warnings.push(`Unrecognised age "${rawAge}" — left blank`);
  }

  let openingBalance = 0;
  const rawBal = pick(row, "opening_balance", "balance", "dues", "outstanding", "due", "old_balance");
  if (rawBal) {
    const n = parseAmount(rawBal);
    if (n != null && n >= 0) openingBalance = n;
    else warnings.push(`Unrecognised balance "${rawBal}" — treated as 0`);
  }

  let registeredAt: Date | null = null;
  const rawReg = pick(row, "registered_on", "registration_date", "first_visit", "date_registered", "created_on");
  if (rawReg) {
    const d = parseImportDate(rawReg);
    if (d) registeredAt = new Date(`${d}T12:00:00`);
    else warnings.push(`Unrecognised registration date "${rawReg}" — using today`);
  }

  return {
    kind: "ready",
    warnings,
    data: {
      fullName: fullName.slice(0, 200),
      phone,
      email: pick(row, "email") || null,
      dateOfBirth: dob,
      gender: pick(row, "gender", "sex") || null,
      address: pick(row, "address") || null,
      externalRef:
        pick(row, "external_ref", "patient_id", "old_id", "file_no", "reg_no", "patient_no", "id", "mrn", "reference_no") ||
        null,
      reference: pick(row, "reference", "referred_by", "referral", "source") || null,
      openingBalance,
      registeredAt,
    },
  };
}

/** Parse + validate + dedup against existing (and in-file) phones. Clinic-scoped. */
async function analyze(
  clinicId: string,
  filename: string,
  buf: ArrayBuffer,
): Promise<{ headers: string[]; total: number; results: { row: number; res: RowResult<PatientInput> }[] }> {
  const { rows, headers } = await parseImportFile(filename, buf);
  const existing = await db
    .select({ phone: patients.phone })
    .from(patients)
    .where(byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt)));
  const seen = new Set(existing.map((r) => r.phone).filter(Boolean) as string[]);

  const results = rows.map((row, i) => {
    let res = validateRow(row);
    if (res.kind === "ready" && res.data.phone) {
      if (seen.has(res.data.phone)) {
        res = { kind: "duplicate", reason: `A patient with phone ${res.data.phone} already exists` };
      } else {
        seen.add(res.data.phone); // also catches duplicates within the file
      }
    }
    return { row: i + 2, res }; // +2: 1-based rows + the header line
  });

  return { headers, total: rows.length, results };
}

export async function previewPatients(clinicId: string, filename: string, buf: ArrayBuffer): Promise<ImportPreview> {
  const { headers, total, results } = await analyze(clinicId, filename, buf);
  return summarize("patients", headers, total, results);
}

export async function commitPatients(
  clinicId: string,
  filename: string,
  buf: ArrayBuffer,
  actor: { id: string; name: string },
): Promise<ImportResult> {
  const { results } = await analyze(clinicId, filename, buf);
  const ready = results.flatMap((r) => (r.res.kind === "ready" ? [r.res.data] : []));
  const skipped = results.filter((r) => r.res.kind === "duplicate").length;
  const errored = results.filter((r) => r.res.kind === "error").length;
  const warnings = results.filter((r) => r.res.kind === "ready" && r.res.warnings.length > 0).length;

  if (ready.length === 0) {
    return { batchId: "", imported: 0, skipped, errored, warnings };
  }

  const batchId = await db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(importBatches)
      .values({
        clinicId,
        entity: "patients",
        filename,
        counts: { imported: ready.length, skipped, errored, warnings },
        createdBy: actor.id,
        createdByName: actor.name,
      })
      .returning({ id: importBatches.id });

    // Allocate a contiguous MRN block by locking the clinic row (same scheme as
    // createPatient, batched): reserve `ready.length` numbers, bump next_mrn once.
    const [c] = await tx
      .select({ nextMrn: clinics.nextMrn })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .for("update")
      .limit(1);
    let mrn = c?.nextMrn ?? 1;
    await tx
      .update(clinics)
      .set({ nextMrn: mrn + ready.length, updatedAt: new Date() })
      .where(eq(clinics.id, clinicId));

    const values = ready.map((p) => ({
      clinicId,
      mrn: mrn++,
      importBatchId: batch.id,
      fullName: p.fullName,
      phone: p.phone,
      email: p.email,
      dateOfBirth: p.dateOfBirth,
      gender: p.gender,
      address: p.address,
      externalRef: p.externalRef,
      reference: p.reference,
      openingBalance: p.openingBalance,
      // A "registered on" column sets created_at so the MRN's date segment reflects
      // the real first visit, not the import day.
      ...(p.registeredAt ? { createdAt: p.registeredAt } : {}),
    }));
    for (let i = 0; i < values.length; i += 500) {
      await tx.insert(patients).values(values.slice(i, i + 500));
    }
    return batch.id;
  });

  return { batchId, imported: ready.length, skipped, errored, warnings };
}
