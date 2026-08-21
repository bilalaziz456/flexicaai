/**
 * Regression test for DRAFT OWNERSHIP (delta D-16, fixed 2026-08-21).
 *
 * CLAUDE.md §8: "A draft still belongs to whoever dictated it: only its author can
 * reopen or approve it." `loadDraft` enforced that; `approveVisit` and `discardDraft`
 * did not — they scoped to the clinic only, so any holder of `clinical:create` could
 * sign off or bin a colleague's dictated note, and the record would then carry THEIR
 * name in `approved_by` over someone else's clinical judgement.
 *
 * WHAT THIS COVERS: the two actions are Server Actions, so the HTTP e2e suite can't
 * reach them — but the fix IS the WHERE clause, so that is what is asserted here,
 * running the exact predicates the actions build against real rows. It does NOT
 * cover the surrounding permission check (`can(clinical:create)`), which the e2e
 * suite already exercises through /api/ai/scribe.
 *
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-draft-ownership.ts`
 */
import { Pool } from "pg";

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

// The predicates the actions build, verbatim in shape:
//   byClinic(clinic_id) + notDeleted + id + status='draft' + doctor_id = <actor>
const APPROVE = `
  update visits
     set status = 'approved', approved_at = now(), approved_by = $3, updated_at = now()
   where clinic_id = $1 and deleted_at is null and id = $2
     and status = 'draft' and doctor_id = $3
  returning id`;

const DISCARD = `
  update visits
     set deleted_at = now(), deleted_by = $3, delete_group = gen_random_uuid(),
         deleted_by_cascade = false
   where clinic_id = $1 and deleted_at is null and id = $2
     and status = 'draft' and doctor_id = $3
  returning id`;

const uniq = Date.now();
let clinicId = "";
let docA = "";
let docB = "";
let patientId = "";

async function seed() {
  const c = await pool.query(
    `insert into clinics (name, modules_enabled) values ($1, '{dental}') returning id`,
    [`d16 test ${uniq}`],
  );
  clinicId = c.rows[0].id;

  const mkDoctor = async (n: string) =>
    (
      await pool.query(
        `insert into users (clinic_id, username, password_hash, role, full_name)
         values ($1, $2, 'x', 'doctor', $3) returning id`,
        [clinicId, `d16_${n}_${uniq}`, `Doctor ${n}`],
      )
    ).rows[0].id;
  docA = await mkDoctor("a");
  docB = await mkDoctor("b");

  patientId = (
    await pool.query(
      `insert into patients (clinic_id, full_name) values ($1, 'D16 Patient') returning id`,
      [clinicId],
    )
  ).rows[0].id;
}

/** A fresh draft dictated by doctor A. */
async function newDraft(): Promise<string> {
  const r = await pool.query(
    `insert into visits (clinic_id, patient_id, doctor_id, module, status, note)
     values ($1, $2, $3, 'dental', 'draft', '{}'::jsonb) returning id`,
    [clinicId, patientId, docA],
  );
  return r.rows[0].id;
}

async function main() {
  await seed();

  console.log("Approving a draft:");
  {
    const v = await newDraft();

    const byOther = await pool.query(APPROVE, [clinicId, v, docB]);
    check("another clinician CANNOT approve it", byOther.rowCount, 0);

    const still = await pool.query(`select status, approved_by from visits where id = $1`, [v]);
    check("…and it is untouched", still.rows[0].status, "draft");
    check("…with no approver recorded", still.rows[0].approved_by, null);

    const byAuthor = await pool.query(APPROVE, [clinicId, v, docA]);
    check("the author CAN approve it", byAuthor.rowCount, 1);

    const done = await pool.query(`select status, approved_by from visits where id = $1`, [v]);
    check("…status becomes approved", done.rows[0].status, "approved");
    check("…and approved_by is the author", done.rows[0].approved_by, docA);

    // status='draft' in the predicate makes approval single-shot.
    const again = await pool.query(APPROVE, [clinicId, v, docA]);
    check("an approved visit cannot be re-approved", again.rowCount, 0);
  }

  console.log("\nDiscarding a draft:");
  {
    const v = await newDraft();

    const byOther = await pool.query(DISCARD, [clinicId, v, docB]);
    check("another clinician CANNOT discard it", byOther.rowCount, 0);

    const still = await pool.query(`select deleted_at from visits where id = $1`, [v]);
    check("…and it survives", still.rows[0].deleted_at, null);

    const byAuthor = await pool.query(DISCARD, [clinicId, v, docA]);
    check("the author CAN discard it", byAuthor.rowCount, 1);

    const gone = await pool.query(
      `select deleted_at is not null as trashed, deleted_by from visits where id = $1`,
      [v],
    );
    check("…it soft-deletes to Trash", gone.rows[0].trashed, true);
    check("…recorded against the author", gone.rows[0].deleted_by, docA);
  }

  console.log("\nThe clinic boundary still holds underneath:");
  {
    const v = await newDraft();
    // Right author, wrong clinic — the author check must not have replaced the
    // tenant check, only joined it.
    const other = await pool.query(APPROVE, [
      "00000000-0000-0000-0000-000000000000",
      v,
      docA,
    ]);
    check("a foreign clinic_id matches nothing", other.rowCount, 0);
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
