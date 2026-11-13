import "server-only";

import { and, asc, count, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/core/db";
import { appointments, patients, users, visits } from "@/core/db/schema";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointmentStatusId, visitStatusId } from "@/core/db/vocabulary-seed";
import { SERVER_TZ } from "@/core/lib/server-tz";
import type { NoteFilter } from "@/core/clinical/notes-period";

/**
 * The Clinical notes list (owner, 2026-11-14): the clinic's appointments in a period,
 * each with the note written for it — or none. Who wrote it, whether it was dictated
 * or typed, who approved it, whether it still waits for the patient's doctor.
 *
 * WHICH NOTE BELONGS TO AN APPOINTMENT. Since 2026-11-14 a note started from an
 * appointment carries its `appointment_id`. Notes before that carry none, so one is
 * taken to belong to an appointment when it is for the same patient on the same
 * clinic day and is linked to no other appointment. A linked note always wins over
 * one matched by day; an approved one over one still in progress; then the newest.
 * A failed recording is not a note.
 */

const NOT_A_NOTE = visitStatusId("failed");

/** The SQL that finds the note for the outer `appointments` row (null = none). */
function noteForAppointmentSql(column: SQL): SQL {
  return sql`(
    select ${column} from ${visits} nv
    where nv.clinic_id = ${appointments.clinicId}
      and nv.deleted_at is null
      and nv.status <> ${NOT_A_NOTE}
      and (
        nv.appointment_id = ${appointments.id}
        or (
          nv.appointment_id is null
          and nv.patient_id = ${appointments.patientId}
          and date(nv.visit_date at time zone cast(${SERVER_TZ} as text))
            = date(${appointments.scheduledAt} at time zone cast(${SERVER_TZ} as text))
        )
      )
    order by (nv.appointment_id is not null) desc,
             (nv.status = ${visitStatusId("approved")}) desc,
             nv.created_at desc
    limit 1
  )`;
}

const noteIdSql = noteForAppointmentSql(sql.raw("nv.id"));
/** The id of the note written for the outer `appointments` row, or null — for any
 *  query that selects from `appointments` (the doctor's queue reads it). */
export const appointmentNoteIdSql = noteIdSql;
const noteStatusSql = noteForAppointmentSql(sql.raw("nv.status"));

function noteFilterSql(filter: NoteFilter): SQL | undefined {
  if (filter === "missing") return sql`${noteIdSql} is null`;
  if (filter === "written") return sql`${noteStatusSql} = ${visitStatusId("approved")}`;
  if (filter === "waiting") {
    return sql`${noteStatusSql} in (${visitStatusId("pending_approval")}, ${visitStatusId("returned")}, ${visitStatusId("draft")}, ${visitStatusId("transcribing")})`;
  }
  return undefined;
}

/** Local-midnight bounds of an inclusive "YYYY-MM-DD" range (the server's clinic day). */
function bounds(from: string, to: string) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return { start: new Date(fy, fm - 1, fd), endExclusive: new Date(ty, tm - 1, td + 1) };
}

export async function listNotesAppointments(
  clinicId: string,
  f: { from: string; to: string; doctorId?: string; note: NoteFilter; limit: number; offset: number },
) {
  const { start, endExclusive } = bounds(f.from, f.to);
  const where = byClinic(
    appointments.clinicId,
    clinicId,
    notDeleted(appointments.deletedAt),
    gte(appointments.scheduledAt, start),
    lt(appointments.scheduledAt, endExclusive),
    f.doctorId ? eq(appointments.doctorId, f.doctorId) : undefined,
    noteFilterSql(f.note),
  );
  const doctor = alias(users, "appt_doctor");

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: appointments.id,
        scheduledAt: appointments.scheduledAt,
        queueNumber: appointments.queueNumber,
        status: appointments.status,
        patientId: patients.id,
        patientName: patients.fullName,
        mrn: patients.mrnLabel,
        doctorId: appointments.doctorId,
        doctorName: doctor.fullName,
        doctorPrefix: doctor.prefix,
        doctorUsername: doctor.username,
        noteId: sql<string | null>`${noteIdSql}`,
      })
      .from(appointments)
      .innerJoin(patients, eq(appointments.patientId, patients.id))
      .leftJoin(doctor, eq(appointments.doctorId, doctor.id))
      .where(where)
      .orderBy(
        desc(sql`date(${appointments.scheduledAt} at time zone cast(${SERVER_TZ} as text))`),
        sql`${appointments.queueNumber} asc nulls last`,
        asc(appointments.scheduledAt),
        asc(appointments.id),
      )
      .limit(f.limit)
      .offset(f.offset),
    db
      .select({
        total: count(),
        // The whole filtered set, never the page (ADR-024).
        missing: sql<number>`count(*) filter (where ${noteIdSql} is null
          and ${appointments.status} = ${appointmentStatusId("completed")})::int`,
      })
      .from(appointments)
      .innerJoin(patients, eq(appointments.patientId, patients.id))
      .where(where),
  ]);

  const notes = await notesById(clinicId, rows.map((r) => r.noteId).filter((id): id is string => Boolean(id)));
  return {
    rows: rows.map((r) => ({ ...r, note: r.noteId ? (notes.get(r.noteId) ?? null) : null })),
    total: totals?.total ?? 0,
    completedWithoutNote: totals?.missing ?? 0,
  };
}

/** Who wrote, approved and must approve each note on the page. */
async function notesById(clinicId: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, NoteSummary>();
  return new Map((await selectNotes(clinicId, ids)).map((r) => [r.id, r]));
}

function selectNotes(clinicId: string, ids: string[]) {
  const author = alias(users, "n_author");
  const approver = alias(users, "n_approver");
  const treating = alias(users, "n_treating");
  return db
    .select({
      id: visits.id,
      status: visits.status,
      voice: sql<boolean>`${visits.audioKey} is not null`,
      createdAt: visits.createdAt,
      approvedAt: visits.approvedAt,
      authorId: visits.doctorId,
      authorName: author.fullName,
      authorPrefix: author.prefix,
      authorUsername: author.username,
      approverName: approver.fullName,
      approverPrefix: approver.prefix,
      approverUsername: approver.username,
      treatingName: treating.fullName,
      treatingPrefix: treating.prefix,
      treatingUsername: treating.username,
    })
    .from(visits)
    .leftJoin(author, eq(visits.doctorId, author.id))
    .leftJoin(approver, eq(visits.approvedBy, approver.id))
    .leftJoin(treating, eq(visits.treatingDoctorId, treating.id))
    .where(and(byClinic(visits.clinicId, clinicId, notDeleted(visits.deletedAt)), inArray(visits.id, ids)));
}

export type NoteSummary = Awaited<ReturnType<typeof selectNotes>>[number];
export type NotesAppointmentRow = Awaited<ReturnType<typeof listNotesAppointments>>["rows"][number];

/** The appointment a note is being started from — its patient and doctor. */
export async function getAppointmentForNote(clinicId: string, appointmentId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(appointmentId)) return null;
  const doctor = alias(users, "appt_doctor");
  const [row] = await db
    .select({
      id: appointments.id,
      scheduledAt: appointments.scheduledAt,
      queueNumber: appointments.queueNumber,
      patientId: patients.id,
      patientName: patients.fullName,
      patientPhone: patients.phone,
      doctorId: appointments.doctorId,
      doctorName: doctor.fullName,
      doctorPrefix: doctor.prefix,
      doctorUsername: doctor.username,
    })
    .from(appointments)
    .innerJoin(patients, eq(appointments.patientId, patients.id))
    .leftJoin(doctor, eq(appointments.doctorId, doctor.id))
    .where(byClinic(appointments.clinicId, clinicId, notDeleted(appointments.deletedAt), eq(appointments.id, appointmentId)))
    .limit(1);
  return row ?? null;
}
