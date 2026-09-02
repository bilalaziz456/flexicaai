/**
 * Delta D-18 — a draft whose author can no longer log in.
 *
 * Approve, discard and both listings all require `doctor_id = <caller>` (ADR-007:
 * approving a note is signing it, so only the clinician who dictated it may). That is
 * correct while the author can still authenticate. When they cannot — deleted,
 * suspended, deactivated, purged — the draft becomes unreachable by EVERYONE, and
 * nothing anywhere says so.
 *
 * Two things are asserted, and they are different in kind:
 *
 *  1. THE WARNING (fixed). `countOpenDrafts` is what the staff-delete dialog asks
 *     before an admin confirms, so the admin is told "this person has N unapproved
 *     notes" instead of discovering it when a patient's record turns out to be short
 *     one visit. This must keep working.
 *
 *  2. THE GAP ITSELF (still open, pending a product decision). The remaining checks
 *     PIN THE CURRENT BEHAVIOUR — they assert the draft really is invisible in all
 *     four places it could surface. They are not endorsing it. When D-18 is decided,
 *     whichever of these flips is the proof the fix landed; until then they stop the
 *     shape of the problem being misremembered, since the delta was originally
 *     written around `doctor_id IS NULL` and that turns out to be the RARE path.
 *
 * The load-bearing discovery is check 3: users are SOFT-deleted, so `ON DELETE SET
 * NULL` never fires and `doctor_id` keeps pointing at the trashed account. A fix
 * keyed on `doctor_id IS NULL` would miss every ordinary staff deletion.
 *
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-orphaned-drafts.ts`
 */
import { Pool } from "pg";
import { userRoleId, visitStatusId, type UserRoleCode } from "@/core/db/vocabulary-seed";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`);
  }
}

/** `core/clinical/drafts.ts#countOpenDrafts` — what the delete dialog asks. */
const COUNT_OPEN_DRAFTS = `
  select count(*)::int as n from visits
   where clinic_id = $1 and deleted_at is null
     and doctor_id = $2 and status = ${visitStatusId("draft")}`;

/** The scribe's own draft list / loadDraft — author-scoped. */
const AUTHORS_DRAFTS = `
  select id from visits
   where clinic_id = $1 and deleted_at is null
     and status = ${visitStatusId("draft")} and doctor_id = $2`;

/**
 * `core/clinical/drafts.ts#authorIsStranded()` — the author can no longer log in.
 * Soft-deleted OR suspended/deactivated OR purged (the only case leaving a NULL).
 */
const STRANDED = `(
  visits.doctor_id is null
  or exists (
    select 1 from users u
     where u.id = visits.doctor_id
       and (u.deleted_at is not null or u.is_active = false)
  )
)`;

/**
 * `draftAccessCondition(userId, canHandover)` — the ONE predicate the three
 * operations share. Without the grant it collapses to the author check.
 */
const ACCESS_WITHOUT_HANDOVER = `
  select id from visits
   where clinic_id = $1 and deleted_at is null and id = $2
     and status = ${visitStatusId("draft")} and doctor_id = $3`;

const ACCESS_WITH_HANDOVER = `
  select id from visits
   where clinic_id = $1 and deleted_at is null and id = $2
     and status = ${visitStatusId("draft")} and (doctor_id = $3 or ${STRANDED})`;

/** `listStrandedDrafts` — what a `handover:view` holder is shown. */
const STRANDED_LIST = `
  select v.id from visits v
   where v.clinic_id = $1 and v.deleted_at is null and v.status = ${visitStatusId("draft")}
     and (
       v.doctor_id is null
       or exists (select 1 from users u where u.id = v.doctor_id
                    and (u.deleted_at is not null or u.is_active = false))
     )`;

/** `patient-detail.tsx` — approved visits, plus your own drafts. */
const PATIENT_TIMELINE = `
  select id from visits
   where clinic_id = $1 and deleted_at is null and patient_id = $2
     and (status = ${visitStatusId("approved")} or doctor_id = $3)`;

/** `core/trash` — only rows actually soft-deleted, non-cascade. */
const TRASH = `
  select id from visits
   where clinic_id = $1 and deleted_at is not null and deleted_by_cascade = false`;

const uniq = Date.now();
let clinicId = "";
let author = "";
let otherDoctor = "";
let admin = "";
let patientId = "";
let draftId = "";

async function seed() {
  clinicId = (
    await pool.query(
      `insert into clinics (name, modules_enabled) values ($1, '{dental}') returning id`,
      [`d18 test ${uniq}`],
    )
  ).rows[0].id;

  const mkUser = async (n: string, role: UserRoleCode) =>
    (
      await pool.query(
        `insert into users (clinic_id, username, password_hash, role, full_name)
         values ($1, $2, 'x', $3, $4) returning id`,
        [clinicId, `d18_${n}_${uniq}`, userRoleId(role), `User ${n}`],
      )
    ).rows[0].id;
  author = await mkUser("author", "doctor");
  otherDoctor = await mkUser("other", "doctor");
  admin = await mkUser("admin", "clinic_admin");

  patientId = (
    await pool.query(
      `insert into patients (clinic_id, full_name) values ($1, 'D18 Patient') returning id`,
      [clinicId],
    )
  ).rows[0].id;

  draftId = (
    await pool.query(
      `insert into visits (clinic_id, patient_id, doctor_id, module, status, note, transcript)
       values ($1, $2, $3, 'dental', ${visitStatusId("draft")}, '{}'::jsonb, 'dictated words') returning id`,
      [clinicId, patientId, author],
    )
  ).rows[0].id;
}

async function main() {
  await seed();

  console.log("\nBEFORE the author is deleted — the draft behaves normally:");
  {
    const n = await pool.query(COUNT_OPEN_DRAFTS, [clinicId, author]);
    check("the delete dialog would warn about 1 unapproved note", n.rows[0].n, 1);

    const mine = await pool.query(AUTHORS_DRAFTS, [clinicId, author]);
    check("…and the author can see it", mine.rowCount, 1);
  }

  console.log("\nThe admin deletes the author (SOFT delete, as deleteStaff does):");
  await pool.query(
    `update users set deleted_at = now(), deleted_by = $2, delete_group = gen_random_uuid(),
            deleted_by_cascade = false
      where id = $1`,
    [author, admin],
  );

  {
    // The load-bearing one: this is why a `doctor_id IS NULL` fix would not work.
    const row = await pool.query(`select doctor_id from visits where id = $1`, [draftId]);
    check(
      "the draft still points at the deleted author — doctor_id is NOT null",
      row.rows[0].doctor_id === author,
      true,
    );

    const live = await pool.query(
      `select v.deleted_at is null as live, vs.code as status from visits v
         join visit_statuses vs on vs.id = v.status where v.id = $1`,
      [draftId],
    );
    check("the visit row itself is untouched — live, still a draft", live.rows[0], {
      live: true,
      status: "draft",
    });
  }

  console.log("\nWITHOUT the `handover` grant, nothing changes — the rule still holds:");
  {
    const theirs = await pool.query(AUTHORS_DRAFTS, [clinicId, otherDoctor]);
    check("another doctor's own-draft list — not there", theirs.rowCount, 0);

    const adminList = await pool.query(AUTHORS_DRAFTS, [clinicId, admin]);
    check("the clinic admin's own-draft list — not there", adminList.rowCount, 0);

    const timeline = await pool.query(PATIENT_TIMELINE, [clinicId, patientId, otherDoctor]);
    check("the patient's timeline — still not there (unapproved)", timeline.rowCount, 0);

    const trash = await pool.query(TRASH, [clinicId]);
    check("Trash — not there either, nothing was deleted", trash.rowCount, 0);

    const reach = await pool.query(ACCESS_WITHOUT_HANDOVER, [clinicId, draftId, otherDoctor]);
    check("and it cannot be opened, approved or discarded", reach.rowCount, 0);
  }

  console.log("\nWITH `handover`, it becomes reachable — and ONLY because it is stranded:");
  {
    const listed = await pool.query(STRANDED_LIST, [clinicId]);
    check("it appears in the stranded list", listed.rowCount, 1);

    const reach = await pool.query(ACCESS_WITH_HANDOVER, [clinicId, draftId, otherDoctor]);
    check("a holder can open/approve/discard it", reach.rowCount, 1);
  }

  console.log("\nThe grant is NARROW — it does not reach an ACTIVE colleague's draft:");
  {
    // This is the check that keeps ADR-007 intact. A `handover` holder must not be
    // able to sign off a note whose author is sitting in the next room and perfectly
    // able to review it themselves — that would trade the rule away for the whole
    // clinic in order to fix the rare stranded case.
    const liveDraft = (
      await pool.query(
        `insert into visits (clinic_id, patient_id, doctor_id, module, status, note)
         values ($1, $2, $3, 'dental', ${visitStatusId("draft")}, '{}'::jsonb) returning id`,
        [clinicId, patientId, otherDoctor],
      )
    ).rows[0].id;

    const listed = await pool.query(STRANDED_LIST, [clinicId]);
    check("an active doctor's draft is NOT in the stranded list", listed.rowCount, 1);

    const reach = await pool.query(ACCESS_WITH_HANDOVER, [clinicId, liveDraft, admin]);
    check("…and a handover holder still cannot touch it", reach.rowCount, 0);

    const owner = await pool.query(ACCESS_WITH_HANDOVER, [clinicId, liveDraft, otherDoctor]);
    check("…while its own author still can", owner.rowCount, 1);
  }

  console.log("\nApproving an adopted draft records BOTH people:");
  {
    await pool.query(
      `update visits set status = ${visitStatusId("approved")}, approved_at = now(), approved_by = $2
        where id = $1`,
      [draftId, admin],
    );
    const row = await pool.query(
      `select doctor_id, approved_by from visits where id = $1`,
      [draftId],
    );
    check("who dictated it is unchanged", row.rows[0].doctor_id === author, true);
    check("who signed it is the adopter", row.rows[0].approved_by === admin, true);
    check("the two differ, so the timeline shows both", row.rows[0].doctor_id !== row.rows[0].approved_by, true);

    // Put it back so the checks below still describe a draft.
    await pool.query(
      `update visits set status = ${visitStatusId("draft")}, approved_at = null, approved_by = null
        where id = $1`,
      [draftId],
    );
  }

  console.log("\nThe clinical content is still on disk — this is data loss by silence:");
  {
    const kept = await pool.query(
      `select transcript is not null as has_transcript, note is not null as has_note
         from visits where id = $1`,
      [draftId],
    );
    check("transcript and note are both still stored", kept.rows[0], {
      has_transcript: true,
      has_note: true,
    });
  }

  console.log("\nSuspension counts too — the test is 'cannot log in', not 'was deleted':");
  {
    // Deliberate: a suspended doctor cannot approve their own draft either, so the
    // note is just as stuck. Unlike deletion this is REVERSIBLE — reactivating the
    // account hands it straight back, which is why the delete dialog suggests
    // suspending as the safer option.
    await pool.query(`update users set deleted_at = null, is_active = false where id = $1`, [
      author,
    ]);
    const suspended = await pool.query(STRANDED_LIST, [clinicId]);
    check("a suspended author's draft is stranded", suspended.rowCount, 1);

    await pool.query(`update users set is_active = true where id = $1`, [author]);
    const restored = await pool.query(STRANDED_LIST, [clinicId]);
    check("reactivating the account un-strands it immediately", restored.rowCount, 0);

    const mine = await pool.query(AUTHORS_DRAFTS, [clinicId, author]);
    check("…and the original author owns it again", mine.rowCount, 1);
  }

  // Hard delete: this is test scaffolding, not clinic data.
  await pool.query(`delete from visits where clinic_id = $1`, [clinicId]);
  await pool.query(`delete from patients where clinic_id = $1`, [clinicId]);
  await pool.query(`delete from users where clinic_id = $1`, [clinicId]);
  await pool.query(`delete from clinics where id = $1`, [clinicId]);
  console.log("\nseeded rows removed");
}

main()
  .catch((e) => {
    failures++;
    console.error(e);
  })
  .finally(async () => {
    await pool.end();
    console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
