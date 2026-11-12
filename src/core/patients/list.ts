import "server-only";

import { and, count, desc, eq, gt, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/core/db";
import { appointments, patientPayments, patients, users } from "@/core/db/schema";
import { appointmentNetSql } from "@/core/appointments/bill-sql";
import { procedureTotals } from "@/core/appointments/procedures";
import { owedVisitSql } from "@/core/finance/owed";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { mrnMatchesSql } from "@/core/patients/mrn";
import { patientPhoneMatchSql } from "@/core/patients/search-sql";

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
    const conds = [ilike(patients.fullName, `%${query}%`), patientPhoneMatchSql(query)];
    // The MRN: its number ("42", "0000042") or the printed form ("FA-100042").
    conds.push(mrnMatchesSql(query));
    search = or(...conds);
  }
  return byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt), search);
}

/**
 * What each patient OWES, as joinable pieces (owner's call, 2026-10-31: the list
 * highlights a patient who owes and can be filtered to them). The SAME rule as
 * Receivables and the dashboard's Outstanding: every owed visit (`owedVisitSql`) at
 * `greatest(0, bill − collected)`, plus the imported opening balance net of its
 * `opening` payments — so "Owes money" lists exactly the patients Receivables does,
 * for the same amounts. Pre-aggregated per patient and LEFT JOINed, never correlated,
 * because the filter has to evaluate it for every patient in the clinic (ADR-030).
 */
function patientOwedParts(clinicId: string) {
  const pt = procedureTotals(clinicId);
  const net = appointmentNetSql(pt);
  const visitOwed = db
    .select({
      patientId: appointments.patientId,
      owed: sql<number>`coalesce(sum(greatest(0, ${net} - ${appointments.amountCollected})), 0)::int`.as("visit_owed_amt"),
    })
    .from(appointments)
    .leftJoin(users, eq(users.id, appointments.doctorId))
    .leftJoin(pt, eq(pt.appointmentId, appointments.id))
    .where(byClinic(appointments.clinicId, clinicId, notDeleted(appointments.deletedAt), owedVisitSql()))
    .groupBy(appointments.patientId)
    .as("visit_owed");
  const openingPaid = db
    .select({
      patientId: patientPayments.patientId,
      paid: sql<number>`coalesce(sum(${patientPayments.amount}), 0)::int`.as("opening_paid_amt"),
    })
    .from(patientPayments)
    .where(byClinic(patientPayments.clinicId, clinicId, notDeleted(patientPayments.deletedAt), eq(patientPayments.kind, "opening")))
    .groupBy(patientPayments.patientId)
    .as("opening_paid");
  const owed = sql<number>`(coalesce(${visitOwed.owed}, 0) + greatest(0, ${patients.openingBalance} - coalesce(${openingPaid.paid}, 0)))::int`;
  return { visitOwed, openingPaid, owed };
}

export type PatientListOptions = {
  /** Also read what each patient owes (only for someone allowed to see money). */
  withOwed?: boolean;
  /** Only patients who owe — implies `withOwed`; sorted by the most owed first. */
  owesOnly?: boolean;
};

/**
 * One page of patients, newest first, plus the total the pager needs. With `withOwed`
 * each row carries `owed`, and `owing` counts the matching patients who owe and sums
 * what they owe — over the whole filtered set, never folded from the page.
 */
export async function listClinicPatients(
  clinicId: string,
  q: string,
  paging: { offset: number; limit: number },
  opts: PatientListOptions = {},
): Promise<{ rows: PatientListRow[]; total: number; owing?: { count: number; amount: number } }> {
  const search = patientSearchWhere(clinicId, q);
  if (!opts.withOwed && !opts.owesOnly) {
    const [rows, [totalRow]] = await Promise.all([
      db
        .select(PATIENT_LIST_COLUMNS)
        .from(patients)
        .where(search)
        .orderBy(desc(patients.createdAt))
        .limit(paging.limit)
        .offset(paging.offset),
      db.select({ total: count() }).from(patients).where(search),
    ]);
    return { rows, total: totalRow?.total ?? 0 };
  }

  const { visitOwed, openingPaid, owed } = patientOwedParts(clinicId);
  const where = opts.owesOnly ? and(search, gt(owed, 0)) : search;
  const [rows, [totals]] = await Promise.all([
    db
      .select({ ...PATIENT_LIST_COLUMNS, owed })
      .from(patients)
      .leftJoin(visitOwed, eq(visitOwed.patientId, patients.id))
      .leftJoin(openingPaid, eq(openingPaid.patientId, patients.id))
      .where(where)
      .orderBy(...(opts.owesOnly ? [desc(owed), desc(patients.createdAt)] : [desc(patients.createdAt)]))
      .limit(paging.limit)
      .offset(paging.offset),
    db
      .select({
        total: count(),
        owingCount: sql<number>`count(*) filter (where ${owed} > 0)::int`,
        owingAmount: sql<number>`coalesce(sum(${owed}) filter (where ${owed} > 0), 0)::int`,
      })
      .from(patients)
      .leftJoin(visitOwed, eq(visitOwed.patientId, patients.id))
      .leftJoin(openingPaid, eq(openingPaid.patientId, patients.id))
      .where(where),
  ]);
  return {
    rows: rows.map((r) => ({ ...r, owed: Number(r.owed) })),
    total: totals?.total ?? 0,
    owing: { count: Number(totals?.owingCount ?? 0), amount: Number(totals?.owingAmount ?? 0) },
  };
}

/**
 * Every matching patient, for the CSV. Unbounded ON PURPOSE — a download that stopped
 * at a page would be wrong in a way the file itself could not show. The row shape and
 * filters are the list's, so the two stay in step.
 */
export async function listPatientsForExport(
  clinicId: string,
  q = "",
  opts: PatientListOptions = {},
): Promise<PatientListRow[]> {
  const search = patientSearchWhere(clinicId, q);
  if (!opts.withOwed && !opts.owesOnly) {
    return db.select(PATIENT_LIST_COLUMNS).from(patients).where(search).orderBy(desc(patients.createdAt));
  }
  const { visitOwed, openingPaid, owed } = patientOwedParts(clinicId);
  const rows = await db
    .select({ ...PATIENT_LIST_COLUMNS, owed })
    .from(patients)
    .leftJoin(visitOwed, eq(visitOwed.patientId, patients.id))
    .leftJoin(openingPaid, eq(openingPaid.patientId, patients.id))
    .where(opts.owesOnly ? and(search, gt(owed, 0)) : search)
    .orderBy(...(opts.owesOnly ? [desc(owed), desc(patients.createdAt)] : [desc(patients.createdAt)]));
  return rows.map((r) => ({ ...r, owed: Number(r.owed) }));
}

const PATIENT_LIST_COLUMNS = {
  id: patients.id,
  mrn: patients.mrn,
  mrnLabel: patients.mrnLabel,
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
  mrnLabel: string | null;
  createdAt: Date;
  fullName: string;
  phone: string | null;
  email: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  reference: string | null;
  /** What the patient owes, when the list was asked for it (`withOwed`). */
  owed?: number;
};

/** The booking picker's shape: enough to identify a patient and show their MRN. */
const PATIENT_PICKER_COLUMNS = {
  id: patients.id,
  fullName: patients.fullName,
  phone: patients.phone,
  mrn: patients.mrn,
  mrnLabel: patients.mrnLabel,
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
      mrnLabel: patients.mrnLabel,
      createdAt: patients.createdAt,
    })
    .from(patients)
    .where(byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt), eq(patients.id, patientId)))
    .limit(1);
  return row ?? null;
}

/** The picker's SEARCH — name or phone, in the same shape as `listRecentPatients`. */
export async function searchPatientsForPicker(clinicId: string, q: string, limit = 20) {
  const query = q.trim();
  const search = query
    ? or(ilike(patients.fullName, `%${query}%`), patientPhoneMatchSql(query))
    : undefined;
  return db
    .select(PATIENT_PICKER_COLUMNS)
    .from(patients)
    .where(byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt), search))
    .orderBy(desc(patients.createdAt))
    .limit(limit);
}
