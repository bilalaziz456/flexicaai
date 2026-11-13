/**
 * An account manager acts only on the clinics they manage (owner, 2026-11-14), and
 * the company's "clinic staff" actions reach a CLINIC's staff only — until then they
 * matched a user by id alone, so `clinics:edit` could reset the owner's password.
 *
 * Pins the shared predicate (`managesClinic`) and the core functions' refusal of a
 * team account. The actions call the predicate first; this proves what it decides and
 * that the database layer refuses on its own as well.
 *
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-admin-clinic-scope.ts`
 */
import { Pool } from "pg";
import { userRoleId } from "@/core/db/vocabulary-seed";
import { managesClinic } from "@/core/auth/admin-permissions";
import {
  clinicOfClinicUser,
  resetClinicUserPassword,
  setClinicUserActive,
  updateClinicUserProfile,
} from "@/core/admin/clinics";

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
let staffId = "";
let teamId = "";

async function run() {
  console.log("\nWho may act on a clinic");
  const owner = { id: "o", role: "super_admin", permissions: null };
  const manager = { id: "m", role: "super_admin", permissions: ["clinics:view", "clinics:edit"] };
  check("the owner: any clinic", managesClinic(owner, { assignedTo: "someone-else" }), true);
  check("an account manager: their own", managesClinic(manager, { assignedTo: "m" }), true);
  check("…not another manager's", managesClinic(manager, { assignedTo: "x" }), false);
  check("…not an unassigned one", managesClinic(manager, { assignedTo: null }), false);

  clinicId = (await pool.query(`insert into clinics (name, modules_enabled) values ($1, '{dental}') returning id`, [`scope ${uniq}`])).rows[0].id;
  staffId = (
    await pool.query(
      `insert into users (clinic_id, username, password_hash, role, full_name) values ($1, $2, 'old', ${userRoleId("doctor")}, 'Clinic Doctor') returning id`,
      [clinicId, `scope_doc_${uniq}`],
    )
  ).rows[0].id;
  teamId = (
    await pool.query(
      `insert into users (clinic_id, username, password_hash, role, full_name) values (null, $1, 'old', ${userRoleId("super_admin")}, 'Team Member') returning id`,
      [`scope_team_${uniq}`],
    )
  ).rows[0].id;

  console.log("\nWhose clinic a staff member is");
  check("a clinic's doctor → that clinic", await clinicOfClinicUser(staffId), clinicId);
  check("a company team member → none", await clinicOfClinicUser(teamId), null);
  check("a malformed id → none", await clinicOfClinicUser("nope"), null);

  console.log("\nThe staff functions leave the company team alone");
  await resetClinicUserPassword(teamId, "new");
  await setClinicUserActive(teamId, false);
  await updateClinicUserProfile(teamId, { fullName: "Renamed", username: `scope_team_renamed_${uniq}` });
  const team = (await pool.query(`select password_hash, is_active, full_name from users where id = $1`, [teamId])).rows[0];
  check("password, active and name unchanged", [team.password_hash, team.is_active, team.full_name], ["old", true, "Team Member"]);

  await resetClinicUserPassword(staffId, "new");
  await setClinicUserActive(staffId, false);
  const staff = (await pool.query(`select password_hash, is_active, must_change_password from users where id = $1`, [staffId])).rows[0];
  check("a clinic's staff member is still reached", [staff.password_hash, staff.is_active, staff.must_change_password], ["new", false, true]);
}

async function cleanup() {
  if (teamId) await pool.query(`delete from users where id = $1`, [teamId]);
  if (clinicId) {
    await pool.query(`delete from users where clinic_id = $1`, [clinicId]);
    await pool.query(`delete from clinics where id = $1`, [clinicId]);
  }
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
