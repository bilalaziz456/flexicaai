/**
 * Delta D-01, last file — the super admin's WRITE paths, now in `core/admin/clinics.ts`.
 *
 * `src/app/admin/actions.ts` was the final entry on the ADR-014 allowlist and by far
 * the heaviest: 33 inline queries, including three transactions that decide whether a
 * clinic exists, whether its staff can log in, and whether its whole dataset is
 * retired. e2e never reaches any of them — it signs in as clinic staff, so creating,
 * suspending and trashing a clinic are exactly the paths nothing was covering.
 *
 * A refactor of an untested transaction is only as good as the proof it still behaves,
 * so these run for real against Postgres and assert the parts that are easy to get
 * subtly wrong:
 *
 *   1. Create is ATOMIC — a duplicate username must leave no clinic behind. A clinic
 *      with no way to sign in isn't an account, it's an orphan row.
 *   2. Suspending a clinic ADMIN cascades to their staff and cuts every session;
 *      suspending a doctor touches only that doctor.
 *   3. Reactivating restores access WITHOUT revoking sessions — it gives access back,
 *      it has no business ending sessions that were never cut.
 *   4. A status change to a non-usable status revokes sessions in the SAME transaction.
 *   5. The clinic trash cascades under ONE delete_group with children flagged, leaves
 *      a row trashed EARLIER in its own group, and is idempotent — a second call finds
 *      nothing live and says so rather than reporting success over nothing.
 *
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-admin-clinics.ts`
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../src/core/db";
import {
  appointments,
  clinics,
  patients,
  procedures,
  sessions,
  users,
} from "../src/core/db/schema";
import {
  createClinicWithAdmin,
  getLiveClinic,
  setClinicStatusFields,
  setClinicUserActive,
  softDeleteClinic,
} from "../src/core/admin/clinics";

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

const TAG = `d01x${Date.now()}`;
const clinicIds: string[] = [];

async function cleanup() {
  if (!clinicIds.length) return;
  const staff = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.clinicId, clinicIds));
  const staffIds = staff.map((s) => s.id);
  if (staffIds.length) await db.delete(sessions).where(inArray(sessions.userId, staffIds));
  await db.delete(procedures).where(inArray(procedures.clinicId, clinicIds));
  await db.delete(appointments).where(inArray(appointments.clinicId, clinicIds));
  await db.delete(patients).where(inArray(patients.clinicId, clinicIds));
  await db.delete(users).where(inArray(users.clinicId, clinicIds));
  await db.delete(clinics).where(inArray(clinics.id, clinicIds));
}

/** A live session row for a user, so revocation is observable. */
async function giveSession(userId: string) {
  await db.insert(sessions).values({
    userId,
    tokenHash: `${TAG}-${userId}-${Math.random()}`,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
}

const sessionCount = async (userIds: string[]) =>
  userIds.length
    ? (await db.select({ id: sessions.id }).from(sessions).where(inArray(sessions.userId, userIds))).length
    : 0;

async function main() {
  console.log("Create is atomic — clinic and its first admin, or neither:");
  const clinicId = await createClinicWithAdmin({
    clinicName: `${TAG} Clinic`,
    modulesEnabled: ["dental"],
    assignedTo: null,
    adminUsername: `${TAG}_admin`,
    adminPasswordHash: "x",
    adminFullName: "D01 Owner",
  });
  clinicIds.push(clinicId);

  const live = await getLiveClinic(clinicId);
  check("the clinic exists", live?.name, `${TAG} Clinic`);
  check("with its specialty", live?.modulesEnabled, ["dental"]);

  const [admin] = await db
    .select({ id: users.id, role: users.role, mustChange: users.mustChangePassword })
    .from(users)
    .where(and(eq(users.clinicId, clinicId), eq(users.role, "clinic_admin")));
  check("and its first admin", Boolean(admin), true);
  check("who must set their own password", admin.mustChange, true);

  const clinicsBefore = (
    await db.select({ id: clinics.id }).from(clinics).where(eq(clinics.name, `${TAG} Rollback`))
  ).length;
  let threw = false;
  try {
    // Same username as above → unique violation on the SECOND statement, after the
    // clinic insert. If the two weren't one transaction, the clinic would survive.
    await createClinicWithAdmin({
      clinicName: `${TAG} Rollback`,
      modulesEnabled: ["dental"],
      assignedTo: null,
      adminUsername: `${TAG}_admin`,
      adminPasswordHash: "x",
      adminFullName: "D01 Dupe",
    });
  } catch {
    threw = true;
  }
  const clinicsAfter = (
    await db.select({ id: clinics.id }).from(clinics).where(eq(clinics.name, `${TAG} Rollback`))
  ).length;
  check("a duplicate username fails", threw, true);
  check("leaving NO orphan clinic behind", clinicsAfter, clinicsBefore);

  // Staff to observe the cascade on.
  const [doctor] = await db
    .insert(users)
    .values({
      clinicId,
      username: `${TAG}_doc`,
      passwordHash: "x",
      role: "doctor",
      fullName: "D01 Doctor",
    })
    .returning({ id: users.id });
  const [recep] = await db
    .insert(users)
    .values({
      clinicId,
      username: `${TAG}_rec`,
      passwordHash: "x",
      role: "receptionist",
      fullName: "D01 Reception",
    })
    .returning({ id: users.id });
  const everyone = [admin.id, doctor.id, recep.id];

  console.log("\nSuspending a DOCTOR touches only that doctor:");
  for (const id of everyone) await giveSession(id);
  await setClinicUserActive(doctor.id, false);
  {
    const rows = await db
      .select({ id: users.id, isActive: users.isActive })
      .from(users)
      .where(inArray(users.id, everyone));
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.isActive]));
    check("the doctor is suspended", byId[doctor.id], false);
    check("the admin is untouched", byId[admin.id], true);
    check("the receptionist is untouched", byId[recep.id], true);
    check("only the doctor's session was cut", await sessionCount(everyone), 2);
  }
  await setClinicUserActive(doctor.id, true);

  console.log("\nSuspending the CLINIC ADMIN takes the whole clinic offline:");
  for (const id of everyone) await giveSession(id);
  await setClinicUserActive(admin.id, false);
  {
    const rows = await db
      .select({ id: users.id, isActive: users.isActive })
      .from(users)
      .where(inArray(users.id, everyone));
    check("nobody is active", rows.filter((r) => r.isActive).length, 0);
    check("and every session is revoked", await sessionCount(everyone), 0);
  }

  console.log("\nReactivating gives access back WITHOUT cutting sessions:");
  for (const id of everyone) await giveSession(id);
  const beforeReactivate = await sessionCount(everyone);
  await setClinicUserActive(admin.id, true);
  {
    const rows = await db
      .select({ id: users.id, isActive: users.isActive })
      .from(users)
      .where(inArray(users.id, everyone));
    check("everyone is active again", rows.filter((r) => r.isActive).length, 3);
    check("sessions survived", await sessionCount(everyone), beforeReactivate);
  }

  console.log("\nA non-usable status revokes every staff session in the same write:");
  await setClinicStatusFields(clinicId, { status: "suspended" }, true);
  {
    const c = await getLiveClinic(clinicId);
    check("status is suspended", c?.status, "suspended");
    check("no session survives", await sessionCount(everyone), 0);
  }
  for (const id of everyone) await giveSession(id);
  await setClinicStatusFields(clinicId, { status: "active" }, false);
  {
    const c = await getLiveClinic(clinicId);
    check("back to active", c?.status, "active");
    check("and reactivation left sessions alone", await sessionCount(everyone), 3);
  }

  console.log("\nTrashing the clinic cascades under ONE group:");
  // A patient trashed EARLIER, on its own — the cascade must not sweep it into the
  // clinic's group, or restoring the clinic would revive a record deleted separately.
  const priorGroup = crypto.randomUUID();
  const [oldPatient] = await db
    .insert(patients)
    .values({
      clinicId,
      fullName: `${TAG} Already Trashed`,
      deletedAt: new Date(Date.now() - 86_400_000),
      deletedBy: admin.id,
      deleteGroup: priorGroup,
      deletedByCascade: false,
    })
    .returning({ id: patients.id });
  const [livePatient] = await db
    .insert(patients)
    .values({ clinicId, fullName: `${TAG} Live` })
    .returning({ id: patients.id });
  await db.insert(procedures).values({ clinicId, name: `${TAG} Scaling`, price: 3000 });

  const removed = await softDeleteClinic(clinicId, admin.id);
  check("it reports the clinic was trashed", removed, true);

  {
    const c = await db
      .select({
        deletedAt: clinics.deletedAt,
        group: clinics.deleteGroup,
        cascade: clinics.deletedByCascade,
      })
      .from(clinics)
      .where(eq(clinics.id, clinicId));
    check("the clinic row is soft-deleted, not removed", Boolean(c[0]?.deletedAt), true);
    check("and is the PARENT of the group", c[0]?.cascade, false);
    const group = c[0]!.group;

    const pats = await db
      .select({
        id: patients.id,
        group: patients.deleteGroup,
        cascade: patients.deletedByCascade,
        deletedAt: patients.deletedAt,
      })
      .from(patients)
      .where(eq(patients.clinicId, clinicId));
    const byId = Object.fromEntries(pats.map((p) => [p.id, p]));
    check("the live patient was cascade-hidden", byId[livePatient.id]?.cascade, true);
    check("into the clinic's group", byId[livePatient.id]?.group, group);
    check("the earlier deletion keeps ITS group", byId[oldPatient.id]?.group, priorGroup);
    check("and stays flagged as a direct delete", byId[oldPatient.id]?.cascade, false);

    const staffRows = await db
      .select({ deletedAt: users.deletedAt, group: users.deleteGroup })
      .from(users)
      .where(eq(users.clinicId, clinicId));
    check("all 3 staff are hidden", staffRows.filter((s) => s.deletedAt).length, 3);
    check("under the same one group", new Set(staffRows.map((s) => s.group)).size, 1);
    check("staff sessions are GONE, not trashed", await sessionCount(everyone), 0);

    const procs = await db
      .select({ deletedAt: procedures.deletedAt })
      .from(procedures)
      .where(and(eq(procedures.clinicId, clinicId), isNotNull(procedures.deletedAt)));
    check("procedures cascaded too", procs.length, 1);
  }

  console.log("\nAnd it is idempotent — nothing live left to trash:");
  check("a second call reports nothing found", await softDeleteClinic(clinicId, admin.id), false);
  check("a trashed clinic no longer reads as live", await getLiveClinic(clinicId), null);

  await cleanup();
  console.log("\nseeded rows removed");
}

main()
  .catch(async (e) => {
    failures++;
    console.error(e);
    try {
      await cleanup();
    } catch {
      /* the seed clinic may not exist yet */
    }
  })
  .finally(async () => {
    console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
