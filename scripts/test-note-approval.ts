/**
 * A note written for another doctor's patient waits for that doctor (owner,
 * 2026-11-14) — and the Clinical notes list says, per appointment, whether a note
 * was written, by whom, and whether it waits.
 *
 * Seeds a throwaway clinic (two doctors, a patient, appointments), drives the core
 * functions the actions call, and removes everything afterwards. The permission
 * checks around them are in the actions; `test-scribe-permission.ts` covers who
 * holds which grant.
 *
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-note-approval.ts`
 */
import { Pool } from "pg";
import { userRoleId } from "@/core/db/vocabulary-seed";
import {
  approveWaitingNoteRow,
  discardReturnedNoteRow,
  listNotesAwaitingDoctor,
  loadNoteForReview,
  noteNeedsTreatingApproval,
  resolveTreatingDoctor,
  resubmitReturnedNoteRow,
  returnWaitingNoteRow,
  setDoctorNotesApproval,
} from "@/core/clinical/note-approval";
import { createTypedNote } from "@/core/clinical/scribe";
import { listNotesAppointments } from "@/core/clinical/notes-appointments";
import { notesWindow, resolveNotesWindow } from "@/core/clinical/notes-period";
import { localDateStr } from "@/core/appointments/availability";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`);
  }
}

const uniq = Date.now();
let clinicId = "";
let docA = "";
let docB = "";
let admin = "";
let patientId = "";
let apptA = "";
let apptB = "";
let apptOld = "";

async function seed() {
  clinicId = (
    await pool.query(`insert into clinics (name, modules_enabled) values ($1, '{dental}') returning id`, [`notes ${uniq}`])
  ).rows[0].id;
  const mk = async (n: string, role: "doctor" | "clinic_admin") =>
    (
      await pool.query(
        `insert into users (clinic_id, username, password_hash, role, full_name) values ($1, $2, 'x', ${userRoleId(role)}, $3) returning id`,
        [clinicId, `na_${n}_${uniq}`, `Person ${n}`],
      )
    ).rows[0].id as string;
  docA = await mk("a", "doctor");
  docB = await mk("b", "doctor");
  admin = await mk("admin", "clinic_admin");
  patientId = (
    await pool.query(`insert into patients (clinic_id, full_name) values ($1, 'Notes Patient') returning id`, [clinicId])
  ).rows[0].id;
  const appt = async (doctorId: string, at: string) =>
    (
      await pool.query(
        `insert into appointments (clinic_id, patient_id, doctor_id, scheduled_at) values ($1, $2, $3, $4) returning id`,
        [clinicId, patientId, doctorId, at],
      )
    ).rows[0].id as string;
  const now = new Date();
  now.setHours(11, 0, 0, 0);
  apptA = await appt(docA, now.toISOString());
  apptB = await appt(docB, new Date(now.getTime() + 3600_000).toISOString());
  const old = new Date(now);
  old.setMonth(old.getMonth() - 2);
  apptOld = await appt(docA, old.toISOString());
}

async function statusOf(id: string) {
  const r = await pool.query(
    `select s.code, v.approved_by, v.pending_chart is not null as has_chart, v.review_note
       from visits v join visit_statuses s on s.id = v.status where v.id = $1`,
    [id],
  );
  return r.rows[0];
}

async function run() {
  await seed();
  const note = { chiefComplaint: "Pain", diagnosis: "Caries" };

  console.log("\nWhose patient a note is");
  const forA = await resolveTreatingDoctor(clinicId, { patientId, authorId: docB, appointmentId: apptA });
  check("an appointment's note belongs to its doctor", forA, { treatingDoctorId: docA, appointmentId: apptA });
  const chosen = await resolveTreatingDoctor(clinicId, { patientId, authorId: admin, chosenDoctorId: docB });
  check("without one, to the doctor chosen", chosen, { treatingDoctorId: docB, appointmentId: null });
  check("with neither, to the writer", await resolveTreatingDoctor(clinicId, { patientId, authorId: docA }), { treatingDoctorId: docA, appointmentId: null });
  check("a bad id is refused, not sent to Postgres", "error" in (await resolveTreatingDoctor(clinicId, { patientId, authorId: docA, appointmentId: "x" })), true);
  check("an admin is not a doctor to choose", "error" in (await resolveTreatingDoctor(clinicId, { patientId, authorId: docA, chosenDoctorId: admin })), true);

  console.log("\nWho waits for whom");
  check("your own patient: never", await noteNeedsTreatingApproval(clinicId, docA, docA), false);
  check("another doctor's patient: by default, yes", await noteNeedsTreatingApproval(clinicId, docA, docB), true);
  check("the clinic admin's note too", await noteNeedsTreatingApproval(clinicId, docA, admin), true);

  console.log("\nA note for Dr A's appointment, written by Dr B");
  const waiting = await createTypedNote({
    clinicId, patientId, authorId: docB, module: "dental", note,
    appointmentId: apptA, treatingDoctorId: docA, waitForApproval: true, pendingChart: { "36": { condition: "caries" } },
  });
  let st = await statusOf(waiting.id);
  check("it waits, unsigned, holding its chart change", [st.code, st.approved_by, st.has_chart], ["pending_approval", null, true]);
  check("Dr A sees it waiting", (await listNotesAwaitingDoctor(clinicId, docA)).map((n) => n.id), [waiting.id]);
  check("Dr B is not asked", (await listNotesAwaitingDoctor(clinicId, docB)).length, 0);
  check("Dr B cannot open it for approval", await loadNoteForReview(clinicId, waiting.id, docB), null);
  check("Dr B cannot approve it", await approveWaitingNoteRow(clinicId, waiting.id, docB, note), null);

  console.log("\nSent back, corrected, approved");
  check("Dr A sends it back", (await returnWaitingNoteRow(clinicId, waiting.id, docA, "Tooth 46"))?.authorId, docB);
  st = await statusOf(waiting.id);
  check("…to its writer, with the reason", [st.code, st.review_note], ["returned", "Tooth 46"]);
  check("Dr A cannot reopen a returned note", await loadNoteForReview(clinicId, waiting.id, docA), null);
  check("Dr B can", (await loadNoteForReview(clinicId, waiting.id, docB))?.id, waiting.id);
  await resubmitReturnedNoteRow(clinicId, waiting.id, docB, { note: { ...note, diagnosis: "Caries 46" }, pendingChart: null, approveNow: false });
  st = await statusOf(waiting.id);
  check("sent again, it waits again", [st.code, st.review_note], ["pending_approval", null]);
  const approved = await approveWaitingNoteRow(clinicId, waiting.id, docA, { ...note, diagnosis: "Caries 46" });
  st = await statusOf(waiting.id);
  check("Dr A approves: signed by Dr A, chart change released", [approved?.authorId, st.code, st.approved_by, st.has_chart], [docB, "approved", docA, false]);

  console.log("\nThe doctor switches approval off");
  check("only for a doctor", await setDoctorNotesApproval(clinicId, admin, false), false);
  await setDoctorNotesApproval(clinicId, docB, false);
  check("Dr B's patients' notes no longer wait", await noteNeedsTreatingApproval(clinicId, docB, docA), false);
  const direct = await createTypedNote({
    clinicId, patientId, authorId: docA, module: "dental", note,
    appointmentId: apptB, treatingDoctorId: docB, waitForApproval: false, pendingChart: null,
  });
  st = await statusOf(direct.id);
  check("saved at once, signed by its writer", [st.code, st.approved_by], ["approved", docA]);

  console.log("\nA returned note can be discarded by its writer only");
  const second = await createTypedNote({
    clinicId, patientId, authorId: admin, module: "dental", note,
    appointmentId: null, treatingDoctorId: docA, waitForApproval: true, pendingChart: null,
  });
  await returnWaitingNoteRow(clinicId, second.id, docA, "Not needed");
  check("not by the doctor", await discardReturnedNoteRow(clinicId, second.id, docA), false);
  check("by its writer", await discardReturnedNoteRow(clinicId, second.id, admin), true);

  console.log("\nThe appointments list");
  const today = localDateStr(new Date());
  const todays = await listNotesAppointments(clinicId, { ...notesWindow("today", today), note: "", limit: 50, offset: 0 });
  check("today's two appointments", todays.total, 2);
  const byId = new Map(todays.rows.map((r) => [r.id, r]));
  check("Dr A's shows Dr B's note, approved by Dr A", [byId.get(apptA)?.note?.id, byId.get(apptA)?.note?.status, byId.get(apptA)?.note?.voice], [waiting.id, "approved", false]);
  check("Dr B's shows Dr A's note", byId.get(apptB)?.note?.id, direct.id);
  const onlyA = await listNotesAppointments(clinicId, { ...notesWindow("today", today), doctorId: docA, note: "", limit: 50, offset: 0 });
  check("the Doctor filter", onlyA.rows.map((r) => r.id), [apptA]);
  const three = await listNotesAppointments(clinicId, { ...notesWindow("3m", today), note: "missing", limit: 50, offset: 0 });
  check("3 months, no note yet: the old appointment", three.rows.map((r) => r.id), [apptOld]);
  const written = await listNotesAppointments(clinicId, { ...notesWindow("3m", today), note: "written", limit: 50, offset: 0 });
  check("…and Note written: the other two", written.total, 2);

  // A note from before 2026-11-14 has no appointment: matched by patient and day.
  const legacy = (
    await pool.query(
      `insert into visits (clinic_id, patient_id, doctor_id, module, status, visit_date, note)
       select $1, $2, $3, 'dental', (select id from visit_statuses where code = 'approved'), scheduled_at, '{}'::jsonb
         from appointments where id = $4 returning id`,
      [clinicId, patientId, docA, apptOld],
    )
  ).rows[0].id;
  const old = await listNotesAppointments(clinicId, { ...notesWindow("3m", today), note: "", limit: 50, offset: 0 });
  check("an older unlinked note is found by patient and day", old.rows.find((r) => r.id === apptOld)?.note?.id, legacy);

  console.log("\nThe periods");
  check("This month starts on the 1st", notesWindow("month", "2026-11-14"), { from: "2026-11-01", to: "2026-11-14" });
  check("3 months", notesWindow("3m", "2026-11-14"), { from: "2026-08-15", to: "2026-11-14" });
  check("9 months", notesWindow("9m", "2026-11-14"), { from: "2026-02-15", to: "2026-11-14" });
  check("Year", notesWindow("year", "2026-11-14"), { from: "2025-11-15", to: "2026-11-14" });
  check("dates win over a pill, and a backwards range is turned round", resolveNotesWindow({ period: "year", from: "2026-11-10", to: "2026-11-01" }, "2026-11-14"), { from: "2026-11-01", to: "2026-11-10", period: "" });
  check("nothing chosen = Today", resolveNotesWindow({}, "2026-11-14"), { from: "2026-11-14", to: "2026-11-14", period: "today" });
}

async function cleanup() {
  if (!clinicId) return;
  await pool.query(`delete from visits where clinic_id = $1`, [clinicId]);
  await pool.query(`delete from appointments where clinic_id = $1`, [clinicId]);
  await pool.query(`delete from patients where clinic_id = $1`, [clinicId]);
  await pool.query(`delete from users where clinic_id = $1`, [clinicId]);
  await pool.query(`delete from clinics where id = $1`, [clinicId]);
  console.log("\nseeded rows removed");
}

run()
  .catch((e) => {
    failures++;
    console.error(e);
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error("cleanup failed", e));
    await pool.end();
    console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
