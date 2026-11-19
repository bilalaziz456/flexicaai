/**
 * Editing a SAVED clinical note (owner, 2026-11-19): the form's shape, what counts as a
 * change, and the database path — the earlier text kept, the note marked edited, the
 * prescription and recall following the note. The `clinical:edit` check is in the
 * action; the role defaults are asserted here.
 *
 * Seeds a throwaway clinic and removes everything afterwards.
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-note-edit.ts`
 */
import { Pool } from "pg";
import { userRoleId } from "@/core/db/vocabulary-seed";
import { createTypedNote } from "@/core/clinical/scribe";
import { listNoteVersions, loadSavedNote, replaceSavedNote, syncPrescriptionWithNote, syncRecallWithNote, trashSavedNote } from "@/core/clinical/note-edit";
import { restoreForClinic } from "@/core/trash";
import { changedNoteFields, medicinesChanged, nextVisitChanged, noteForEditing } from "@/core/clinical/note-edit-rules";
import { dentalBlankNote, dentalNoteSchema } from "@/modules/dental/note-schema";
import { blankNoteFrom, pruneEmptyNote } from "@/core/clinical/note-template";
import { parseClinicalNote } from "@/core/clinical/note-schema";
import { asPrescriptionItems, itemToNoteDrug } from "@/core/lib/prescription-items";
import { createPrescriptionFromVisit } from "@/core/patients/prescriptions";
import { ROLE_DEFAULTS } from "@/core/auth/permissions";

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

/** What the form sends back, through the action's own steps. */
function asSaved(note: Record<string, unknown>, rx: unknown[]): Record<string, unknown> {
  const pruned = pruneEmptyNote(note);
  const r = parseClinicalNote({ ...pruned, prescriptions: asPrescriptionItems(rx).map(itemToNoteDrug) }, dentalNoteSchema);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

const uniq = Date.now();
let clinicId = "";
let doc = "";
let patientId = "";

async function seed() {
  clinicId = (
    await pool.query(`insert into clinics (name, modules_enabled) values ($1, '{dental}') returning id`, [`note edit ${uniq}`])
  ).rows[0].id;
  doc = (
    await pool.query(
      `insert into users (clinic_id, username, password_hash, role, full_name) values ($1, $2, 'x', ${userRoleId("doctor")}, 'Edit Doctor') returning id`,
      [clinicId, `ne_${uniq}`],
    )
  ).rows[0].id;
  patientId = (
    await pool.query(`insert into patients (clinic_id, full_name) values ($1, 'Edit Patient') returning id`, [clinicId])
  ).rows[0].id;
}

async function run() {
  console.log("\nWho may edit");
  check("doctors by default", ROLE_DEFAULTS.doctor.includes("clinical:edit"), true);
  check("clinic admins by default", ROLE_DEFAULTS.clinic_admin.includes("clinical:edit"), true);
  check("not the front desk", ROLE_DEFAULTS.receptionist.includes("clinical:edit"), false);
  check("not a manager", ROLE_DEFAULTS.manager.includes("clinical:edit"), false);

  console.log("\nThe form");
  const dictated = {
    chiefComplaint: "Pain lower left",
    findings: [{ tooth: "36", finding: "Deep caries" }],
    diagnosis: "Irreversible pulpitis",
    treatmentPerformed: ["Access opening 36"],
    prescriptions: [{ drug: "Amoxicillin 500mg", dosage: "1 cap TDS", duration: "5 days" }],
    nextVisit: { reason: "RCT", afterDays: 7 },
  };
  const f = noteForEditing(dictated, blankNoteFrom(dentalBlankNote));
  check("a dictated note gets a clinical notes box to add to", "clinicalNotes" in f.note, true);
  check("its own fields stay (treatment performed)", f.note.treatmentPerformed, ["Access opening 36"]);
  check("medicines move to the prescription rows", [f.note.prescriptions === undefined, f.medicines.map((m) => m.name)], [true, ["Amoxicillin 500mg"]]);
  check("the dictated duration becomes the row's", [f.medicines[0].durationValue, f.medicines[0].durationUnit], [5, "days"]);
  check("no medicines → one empty row", noteForEditing({ diagnosis: "x" }, dentalBlankNote).medicines, [{ name: "" }]);
  check("a pruned next visit opens as its fields", noteForEditing({ nextVisit: null }, dentalBlankNote).note.nextVisit, { reason: null, afterDays: null });

  console.log("\nWhat counts as a change");
  const untouched = asSaved(f.note, f.medicines);
  check("opening and saving changes nothing", changedNoteFields(dictated, untouched), []);
  check("medicines unchanged after the round trip", medicinesChanged(dictated, untouched), false);
  const added = asSaved({ ...f.note, clinicalNotes: "Patient anxious; LA given." }, f.medicines);
  check("adding clinical notes is one field", changedNoteFields(dictated, added), ["clinicalNotes"]);
  check("a new medicine is a medicine change", medicinesChanged(dictated, asSaved(f.note, [...f.medicines, { name: "Panadol" }])), true);
  check("next visit changed", nextVisitChanged(dictated, { ...dictated, nextVisit: { reason: "RCT", afterDays: 14 } }), true);
  check("next visit same", nextVisitChanged(dictated, untouched), false);

  console.log("\nThe database");
  await seed();
  const saved = await createTypedNote({
    clinicId, patientId, authorId: doc, module: "dental", note: dictated,
    appointmentId: null, treatingDoctorId: doc, waitForApproval: false, pendingChart: null,
  });
  await createPrescriptionFromVisit(clinicId, saved.id, { id: doc, name: "Edit Doctor" });
  await pool.query(
    `insert into recalls (clinic_id, patient_id, source_visit_id, module, reason, due_at) values ($1, $2, $3, 'dental', 'RCT', now() + interval '7 days')`,
    [clinicId, patientId, saved.id],
  );

  check("a saved note opens for editing", (await loadSavedNote(clinicId, saved.id))?.id, saved.id);
  check("another clinic's id finds nothing", await loadSavedNote("00000000-0000-0000-0000-000000000000", saved.id), null);

  const edited = asSaved(
    { ...f.note, clinicalNotes: "Added later.", nextVisit: { reason: "RCT", afterDays: 14 } },
    [...f.medicines, { name: "Panadol 500mg", frequency: "tds", durationValue: 3, durationUnit: "days" }],
  );
  const r = await replaceSavedNote(clinicId, saved.id, edited, { id: doc, name: "Edit Doctor" });
  check("the edit is saved", r?.patientId, patientId);
  const row = (await pool.query(`select note, edited_by, edited_at is not null as edited, ai_draft from visits where id = $1`, [saved.id])).rows[0];
  check("the note holds the new text", row.note.clinicalNotes, "Added later.");
  check("marked edited, by whom", [row.edited, row.edited_by], [true, doc]);
  const versions = await listNoteVersions(clinicId, saved.id);
  check("the earlier text is kept", [versions.length, versions[0]?.note?.diagnosis, versions[0]?.editedByName], [1, "Irreversible pulpitis", "Edit Doctor"]);

  check("the prescription follows the medicines", await syncPrescriptionWithNote(clinicId, saved.id, edited, { id: doc, name: "Edit Doctor" }), "updated");
  const rx = (await pool.query(`select items from prescriptions where visit_id = $1`, [saved.id])).rows[0];
  check("…with both lines, the new one in full", [rx.items.length, rx.items[1].name, rx.items[1].frequency], [2, "Panadol 500mg", "tds"]);

  check("the waiting recall moves", await syncRecallWithNote(clinicId, { visitId: saved.id, patientId, module: "dental", base: r!.base }, edited), "moved");
  const due = (await pool.query(`select due_at from recalls where source_visit_id = $1`, [saved.id])).rows[0].due_at as Date;
  check("…to 14 days after the visit, not after the edit", Math.round((due.getTime() - r!.base.getTime()) / 86_400_000), 14);

  const cleared = asSaved({ ...f.note, nextVisit: { reason: null, afterDays: null } }, []);
  await replaceSavedNote(clinicId, saved.id, cleared, { id: doc, name: "Edit Doctor" });
  check("all medicines removed → the prescription goes to Trash", await syncPrescriptionWithNote(clinicId, saved.id, cleared, { id: doc, name: "Edit Doctor" }), "removed");
  check("next visit cleared → the recall is cancelled", await syncRecallWithNote(clinicId, { visitId: saved.id, patientId, module: "dental", base: r!.base }, cleared), "cancelled");
  check("a deleted prescription stays deleted", await syncPrescriptionWithNote(clinicId, saved.id, edited, { id: doc, name: "Edit Doctor" }), "kept-deleted");
  check("two edits, two earlier versions", (await listNoteVersions(clinicId, saved.id)).length, 2);

  console.log("\nA clinic with no specialty ticked (owner's report, 2026-11-20)");
  const generic = parseClinicalNote(pruneEmptyNote({ ...blankNoteFrom(undefined), diagnosis: "Gingivitis" }), undefined);
  check("the generic note passes core's checks alone", generic.ok, true);
  const plain = await createTypedNote({
    clinicId, patientId, authorId: doc, module: null, note: generic.ok ? generic.value : {},
    appointmentId: null, treatingDoctorId: doc, waitForApproval: false, pendingChart: null,
  });
  check("a typed note saves with no specialty", (await loadSavedNote(clinicId, plain.id))?.note?.diagnosis, "Gingivitis");

  console.log("\nDeleting a saved note (owner, 2026-11-20)");
  check("clinic admins may delete by default", ROLE_DEFAULTS.clinic_admin.includes("clinical:delete"), true);
  check("doctors may not, unless given it", ROLE_DEFAULTS.doctor.includes("clinical:delete"), false);
  const gone = await createTypedNote({
    clinicId, patientId, authorId: doc, module: "dental", note: dictated,
    appointmentId: null, treatingDoctorId: doc, waitForApproval: false, pendingChart: null,
  });
  await createPrescriptionFromVisit(clinicId, gone.id, { id: doc, name: "Edit Doctor" });
  await pool.query(
    `insert into recalls (clinic_id, patient_id, source_visit_id, reason, due_at) values ($1, $2, $3, 'RCT', now() + interval '7 days'), ($1, $2, $3, 'old', now() - interval '1 day')`,
    [clinicId, patientId, gone.id],
  );
  await pool.query(`update recalls set status = (select id from recall_statuses where code = 'sent') where source_visit_id = $1 and reason = 'old'`, [gone.id]);
  check("another clinic cannot delete it", await trashSavedNote("00000000-0000-0000-0000-000000000000", gone.id, doc), null);
  const t = await trashSavedNote(clinicId, gone.id, doc);
  check("the note goes to Trash with its prescription and waiting recall", t, { patientId, prescription: true, recalls: 1 });
  const grp = (await pool.query(`select delete_group from visits where id = $1`, [gone.id])).rows[0].delete_group;
  const together = (await pool.query(
    `select (select count(*) from prescriptions where visit_id = $1 and delete_group = $2)::int rx,
            (select count(*) from recalls where source_visit_id = $1 and delete_group = $2)::int rc,
            (select count(*) from recalls where source_visit_id = $1 and deleted_at is null)::int sent_left`,
    [gone.id, grp],
  )).rows[0];
  check("…all in one delete group (restored together), the sent recall left", together, { rx: 1, rc: 1, sent_left: 1 });
  check("it no longer opens for editing", await loadSavedNote(clinicId, gone.id), null);
  check("deleting twice finds nothing", await trashSavedNote(clinicId, gone.id, doc), null);
  await restoreForClinic(clinicId, grp);
  const back = (await pool.query(
    `select (select deleted_at is null from visits where id = $1) v,
            (select count(*) from prescriptions where visit_id = $1 and deleted_at is null)::int rx,
            (select count(*) from recalls where source_visit_id = $1 and deleted_at is null)::int rc`,
    [gone.id],
  )).rows[0];
  check("Restore brings back the note, prescription and recall", back, { v: true, rx: 1, rc: 2 });

  await pool.query(`update visits set imported = true where id = $1`, [saved.id]);
  check("an imported note is not edited", await replaceSavedNote(clinicId, saved.id, edited, { id: doc, name: "x" }), null);
}

async function cleanup() {
  if (!clinicId) return;
  await pool.query(`delete from recalls where clinic_id = $1`, [clinicId]);
  await pool.query(`delete from prescriptions where clinic_id = $1`, [clinicId]);
  await pool.query(`delete from clinical_note_versions where clinic_id = $1`, [clinicId]);
  await pool.query(`delete from visits where clinic_id = $1`, [clinicId]);
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
