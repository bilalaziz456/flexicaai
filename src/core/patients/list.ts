import "server-only";

import { count, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { db } from "@/core/db";
import { patients } from "@/core/db/schema";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { mrnDigits, mrnMatchesSql } from "@/core/patients/mrn";

/**
 * The clinic's patient list — CORE per ADR-014, shared by the list page and the CSV
 * export.
 *
 * The two had the same search built inline in both places, and the export's own
 * comment said it "mirrors the list search" — which is the tell. A download that
 * silently returns a different set from the list the user is looking at is worse than
 * no download, because nothing on screen would say so. Now they cannot disagree.
 */

/** Name, phone, or MRN. */
export function patientSearchWhere(clinicId: string, q = ""): SQL | undefined {
  const query = q.trim();
  let search;
  if (query) {
    const conds = [ilike(patients.fullName, `%${query}%`), ilike(patients.phone, `%${query}%`)];
    // Match the MRN's digits (registration date + padded counter) so "42", "0000042"
    // or a pasted "KL-202607270000042" all resolve to the same patient.
    const digits = mrnDigits(query);
    if (digits) conds.push(mrnMatchesSql(digits));
    search = or(...conds);
  }
  return byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt), search);
}

/** One page of patients, newest first, plus the total the pager needs. */
export async function listClinicPatients(
  clinicId: string,
  q: string,
  paging: { offset: number; limit: number },
): Promise<{ rows: PatientListRow[]; total: number }> {
  const where = patientSearchWhere(clinicId, q);
  const [rows, [totalRow]] = await Promise.all([
    db
      .select(PATIENT_LIST_COLUMNS)
      .from(patients)
      .where(where)
      .orderBy(desc(patients.createdAt))
      .limit(paging.limit)
      .offset(paging.offset),
    db.select({ total: count() }).from(patients).where(where),
  ]);
  return { rows, total: totalRow?.total ?? 0 };
}

/**
 * Every matching patient, for the CSV. Unbounded ON PURPOSE — a download that stopped
 * at a page would be wrong in a way the file itself could not show. The row shape is
 * the same as the list, so the two stay in step.
 */
export async function listPatientsForExport(clinicId: string, q = ""): Promise<PatientListRow[]> {
  return db
    .select(PATIENT_LIST_COLUMNS)
    .from(patients)
    .where(patientSearchWhere(clinicId, q))
    .orderBy(desc(patients.createdAt));
}

const PATIENT_LIST_COLUMNS = {
  id: patients.id,
  mrn: patients.mrn,
  createdAt: patients.createdAt,
  fullName: patients.fullName,
  phone: patients.phone,
  email: patients.email,
  gender: patients.gender,
  dateOfBirth: patients.dateOfBirth,
  reference: patients.reference,
} as const;

export type PatientListRow = {
  id: string;
  mrn: number | null;
  createdAt: Date;
  fullName: string;
  phone: string | null;
  email: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  reference: string | null;
};

/** The booking picker's shape: enough to identify a patient and show their MRN. */
const PATIENT_PICKER_COLUMNS = {
  id: patients.id,
  fullName: patients.fullName,
  phone: patients.phone,
  mrn: patients.mrn,
  createdAt: patients.createdAt,
} as const;

/** Most recently added patients, for the booking form's picker. */
export async function listRecentPatients(clinicId: string, limit = 10) {
  return db
    .select(PATIENT_PICKER_COLUMNS)
    .from(patients)
    .where(byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt)))
    .orderBy(desc(patients.createdAt))
    .limit(limit);
}

/** One patient in the picker's shape — the "book for THIS patient" preselect. */
export async function getPatientForPicker(clinicId: string, patientId: string) {
  const [row] = await db
    .select(PATIENT_PICKER_COLUMNS)
    .from(patients)
    .where(byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt), eq(patients.id, patientId)))
    .limit(1);
  return row ?? null;
}

/**
 * The identity block a printed document puts at the top — name, MRN, phone.
 *
 * Shared by the account statement and the clinical chart print: both were selecting
 * the same four columns inline, and a printed record that disagreed with another
 * printed record about who the patient is would be a serious thing to ship.
 */
export async function getPatientHeader(clinicId: string, patientId: string) {
  const [row] = await db
    .select({
      id: patients.id,
      fullName: patients.fullName,
      phone: patients.phone,
      mrn: patients.mrn,
      createdAt: patients.createdAt,
    })
    .from(patients)
    .where(byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt), eq(patients.id, patientId)))
    .limit(1);
  return row ?? null;
}
