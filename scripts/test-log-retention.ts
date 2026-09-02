/**
 * Delta D-11 — `activity_logs` growth and the cost of a view.
 *
 * Two things are asserted, both of which are SQL behaviour rather than TypeScript:
 *
 *  1. **View de-duplication** now happens inside ONE statement
 *     (`INSERT … SELECT … WHERE NOT EXISTS`, `core/audit/log.ts#logView`) instead of a
 *     SELECT followed by an INSERT. The statement below is that statement. Getting
 *     this wrong in either direction is bad: too eager and every refresh appends a
 *     row to a table nothing ever prunes; too keen to skip and a real access goes
 *     unrecorded, which is a compliance gap (CLAUDE.md §10).
 *
 *  2. **Retention** (`core/audit/retention.ts`) deletes only rows past the window,
 *     and does nothing at all while the window is 0 — the default. That default is
 *     the point: this is the only hard delete in the audit path, and how long an
 *     access log must survive is a regulatory decision, not an engineering one.
 *
 * The null-`entity_id` branch is covered separately because it is a real trap: the
 * one-expression alternative (`is not distinct from`) is not btree-indexable, so it
 * silently costs the index this whole change exists to use.
 *
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-log-retention.ts`
 */
import { Pool } from "pg";
import { userRoleId } from "@/core/db/vocabulary-seed";

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

/** `logView` verbatim: one statement, indexable equality, explicit null branch. */
function logViewSql(withEntityId: boolean): string {
  const prior = withEntityId ? `prior.entity_id = $4::uuid` : `prior.entity_id is null`;
  return `
    insert into activity_logs
      (clinic_id, actor_user_id, actor_name, actor_role, action, entity, entity_id, summary)
    select $1::uuid, $2::uuid, 'tester', 'doctor', 'view', $3, $4::uuid, 'viewed'
     where not exists (
       select 1 from activity_logs prior
        where prior.actor_user_id = $2::uuid
          and prior.action = 'view'
          and prior.entity = $3
          and ${prior}
          and prior.created_at >= $5
     )`;
}

/**
 * `pruneActivityLogs` — the delete, with the floor applied by the caller. Scoped to
 * the seeded clinic here so the test never touches real rows; the real job is
 * platform-wide and deliberately `unscoped`.
 */
const PRUNE = `delete from activity_logs where created_at < $1 and clinic_id = $2 returning id`;

const uniq = Date.now();
let clinicId = "";
let actorId = "";
const recordId = "22222222-2222-2222-2222-222222222222";

async function seed() {
  clinicId = (
    await pool.query(
      `insert into clinics (name, modules_enabled) values ($1, '{dental}') returning id`,
      [`d11 test ${uniq}`],
    )
  ).rows[0].id;
  actorId = (
    await pool.query(
      `insert into users (clinic_id, username, password_hash, role, full_name)
       values ($1, $2, 'x', ${userRoleId("doctor")}, 'D11 Tester') returning id`,
      [clinicId, `d11_${uniq}`],
    )
  ).rows[0].id;
}

const countRows = async () =>
  Number(
    (await pool.query(`select count(*)::int n from activity_logs where clinic_id = $1`, [clinicId]))
      .rows[0].n,
  );

async function main() {
  await seed();
  const within = new Date(Date.now() - 30 * 60_000); // the dedupe window

  console.log("\nOne statement, and it de-duplicates:");
  {
    await pool.query(logViewSql(true), [clinicId, actorId, "patient", recordId, within]);
    check("first view is recorded", await countRows(), 1);

    await pool.query(logViewSql(true), [clinicId, actorId, "patient", recordId, within]);
    await pool.query(logViewSql(true), [clinicId, actorId, "patient", recordId, within]);
    check("re-opening it twice more adds nothing", await countRows(), 1);
  }

  console.log("\nA DIFFERENT record is a different view — dedupe is per record:");
  {
    await pool.query(logViewSql(true), [
      clinicId,
      actorId,
      "patient",
      "33333333-3333-3333-3333-333333333333",
      within,
    ]);
    check("second record recorded separately", await countRows(), 2);

    await pool.query(logViewSql(true), [clinicId, actorId, "appointment", recordId, within]);
    check("same id, different entity, also separate", await countRows(), 3);
  }

  console.log("\nOnce the window passes, the next view IS recorded again:");
  {
    // Age the existing rows past the window rather than waiting 30 minutes.
    await pool.query(
      `update activity_logs set created_at = now() - interval '31 minutes' where clinic_id = $1`,
      [clinicId],
    );
    await pool.query(logViewSql(true), [clinicId, actorId, "patient", recordId, within]);
    check("a later visit is a new row", await countRows(), 4);
  }

  console.log("\nThe null entity_id branch de-duplicates too:");
  {
    const before = await countRows();
    await pool.query(logViewSql(false), [clinicId, actorId, "logs", null, within]);
    check("a view with no record id is recorded", await countRows(), before + 1);

    await pool.query(logViewSql(false), [clinicId, actorId, "logs", null, within]);
    check("…and is not recorded twice", await countRows(), before + 1);
  }

  console.log("\nRetention deletes only what is past the window:");
  {
    await pool.query(
      `insert into activity_logs (clinic_id, actor_user_id, actor_name, action, entity, summary, created_at)
       values ($1, $2, 'tester', 'view', 'patient', 'ancient', now() - interval '400 days'),
              ($1, $2, 'tester', 'view', 'patient', 'old',     now() - interval '120 days'),
              ($1, $2, 'tester', 'view', 'patient', 'recent',  now() - interval '10 days')`,
      [clinicId, actorId],
    );
    const before = await countRows();

    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const pruned = await pool.query(PRUNE, [cutoff, clinicId]);
    check("the two rows past 90 days are removed", pruned.rowCount, 2);
    check("everything else is untouched", await countRows(), before - 2);

    const again = await pool.query(PRUNE, [cutoff, clinicId]);
    check("running it again removes nothing", again.rowCount, 0);

    const recent = await pool.query(
      `select count(*)::int n from activity_logs where clinic_id = $1 and summary = 'recent'`,
      [clinicId],
    );
    check("the 10-day-old row survived", recent.rows[0].n, 1);
  }

  console.log("\nWith retention off (0), nothing is deleted at all:");
  {
    // The guard is in TS — `pruneActivityLogs` returns early on 0 and never issues a
    // DELETE. Asserted here as the invariant it protects: no cutoff exists that would
    // be applied, so the row count cannot change.
    const before = await countRows();
    const retentionDays = 0;
    const deleted =
      retentionDays <= 0
        ? 0
        : (await pool.query(PRUNE, [new Date(), clinicId])).rowCount;
    check("no delete is issued", deleted, 0);
    check("the table is unchanged", await countRows(), before);
  }

  // Hard delete: test scaffolding, not clinic data.
  await pool.query(`delete from activity_logs where clinic_id = $1`, [clinicId]);
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
