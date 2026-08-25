/**
 * Peer clinic admins, and the one invariant that makes them safe (2026-08-26).
 *
 * A clinic admin can now create another `clinic_admin` — a full peer, same access,
 * including staff and settings. The alternative people actually reach for is sharing
 * one login, which destroys the audit trail that CLAUDE.md §10 exists to keep.
 *
 * Peerage means admins can suspend and delete EACH OTHER, and that is a footgun unless
 * exactly one rule holds: **a clinic can never be left with no active admin.** Nothing
 * in the product recovers from that state — staff and settings are role-gated on
 * `clinic_admin`, so a clinic with none is locked out of its own account until a super
 * admin intervenes. Every assertion here is about that floor.
 *
 * The second half covers the invariant this feature BROKE and had to repair:
 * `core/admin/clinics.ts#setClinicUserActive` cascaded on ANY `clinic_admin`, which was
 * right when a clinic had exactly one — the admin WAS the clinic. With two, suspending
 * one partner would have suspended every doctor and receptionist and thrown them out
 * mid-shift while the other admin sat there able to sign in.
 *
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-peer-admins.ts`
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/core/db";
import { clinics, sessions, users } from "../src/core/db/schema";
import {
  assertNotLastAdmin,
  countActiveClinicAdmins,
  setClinicStaffActive,
  softDeleteClinicStaff,
} from "../src/core/users/clinic-staff";
import { listClinicStaff } from "../src/core/users/staff-list";
import { setClinicUserActive } from "../src/core/admin/clinics";
import { CLINIC_STAFF_ROLES } from "../src/core/types/auth";

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

const TAG = `peer${Date.now()}`;
let clinicId = "";
const mk = async (role: "clinic_admin" | "doctor" | "receptionist", n: string) => {
  const [row] = await db
    .insert(users)
    .values({
      clinicId,
      username: `${TAG}_${n}`,
      passwordHash: "x",
      role,
      fullName: `${TAG} ${n}`,
    })
    .returning({ id: users.id });
  return row.id;
};

async function giveSession(userId: string) {
  await db.insert(sessions).values({
    userId,
    tokenHash: `${TAG}-${userId}-${Math.random()}`,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
}
const liveSessions = async (ids: string[]) =>
  (await db.select({ id: sessions.id }).from(sessions).where(inArray(sessions.userId, ids))).length;
const isActive = async (id: string) =>
  (await db.select({ a: users.isActive }).from(users).where(eq(users.id, id)))[0]?.a;

async function cleanup() {
  if (!clinicId) return;
  const staff = await db.select({ id: users.id }).from(users).where(eq(users.clinicId, clinicId));
  const ids = staff.map((s) => s.id);
  if (ids.length) await db.delete(sessions).where(inArray(sessions.userId, ids));
  await db.delete(users).where(eq(users.clinicId, clinicId));
  await db.delete(clinics).where(eq(clinics.id, clinicId));
}

async function main() {
  console.log("A clinic admin is a role a clinic admin may create:");
  check("clinic_admin is in CLINIC_STAFF_ROLES", CLINIC_STAFF_ROLES.includes("clinic_admin"), true);

  [{ id: clinicId }] = await db
    .insert(clinics)
    .values({ name: `${TAG} clinic`, modulesEnabled: ["dental"] })
    .returning({ id: clinics.id });

  const adminA = await mk("clinic_admin", "admin_a");
  const doctor = await mk("doctor", "doc");
  const recep = await mk("receptionist", "rec");

  console.log("\nWith ONE admin, that admin is untouchable:");
  check("counted as the only active admin", await countActiveClinicAdmins(clinicId), 1);
  check("suspending them is refused", Boolean(await assertNotLastAdmin(clinicId, adminA, "suspend")), true);
  check("deleting them is refused", Boolean(await assertNotLastAdmin(clinicId, adminA, "delete")), true);
  // The refusal has to be a usable sentence — it is rendered straight to the admin.
  const msg = (await assertNotLastAdmin(clinicId, adminA, "delete")) ?? "";
  check("and says why, in words", msg.includes("only active admin"), true);

  console.log("\nNon-admins are never load-bearing, however few there are:");
  check("the only doctor can be suspended", await assertNotLastAdmin(clinicId, doctor, "suspend"), null);
  check("the only receptionist can be deleted", await assertNotLastAdmin(clinicId, recep, "delete"), null);

  console.log("\nAdd a SECOND admin and the pair become peers:");
  const adminB = await mk("clinic_admin", "admin_b");
  check("two active admins", await countActiveClinicAdmins(clinicId), 2);
  check("A may now be suspended", await assertNotLastAdmin(clinicId, adminA, "suspend"), null);
  check("B may now be suspended", await assertNotLastAdmin(clinicId, adminB, "suspend"), null);
  const staff = await listClinicStaff(clinicId, "", { offset: 0, limit: 50 });
  check(
    "both admins appear in the clinic's own staff list",
    staff.rows.filter((r) => r.role === "clinic_admin").length,
    2,
  );

  console.log("\nA SUSPENDED admin does not count — they cannot sign in:");
  await setClinicStaffActive(clinicId, adminB, false);
  check("back to one active admin", await countActiveClinicAdmins(clinicId), 1);
  check("so A is protected again", Boolean(await assertNotLastAdmin(clinicId, adminA, "suspend")), true);
  check("but suspended B may still be deleted", await assertNotLastAdmin(clinicId, adminB, "delete"), null);
  await setClinicStaffActive(clinicId, adminB, true);

  console.log("\nDeleting one of two admins protects the survivor:");
  check("B deletes cleanly", await softDeleteClinicStaff(clinicId, adminB, adminA), true);
  check("one active admin left", await countActiveClinicAdmins(clinicId), 1);
  check("and A is protected once more", Boolean(await assertNotLastAdmin(clinicId, adminA, "delete")), true);

  // ---- The cascade that had to change ------------------------------------
  console.log("\nSuper admin suspending the LAST admin still takes the clinic offline:");
  for (const id of [adminA, doctor, recep]) await giveSession(id);
  await setClinicUserActive(adminA, false);
  check("the doctor is suspended too", await isActive(doctor), false);
  check("the receptionist is suspended too", await isActive(recep), false);
  check("every session is cut", await liveSessions([adminA, doctor, recep]), 0);

  console.log("\nBut suspending ONE of TWO admins must NOT take the clinic offline:");
  await setClinicUserActive(adminA, true);
  await db.update(users).set({ isActive: true }).where(inArray(users.id, [doctor, recep]));
  const adminC = await mk("clinic_admin", "admin_c");
  for (const id of [adminA, adminC, doctor, recep]) await giveSession(id);

  await setClinicUserActive(adminC, false);
  check("the suspended admin is inactive", await isActive(adminC), false);
  check("the OTHER admin is untouched", await isActive(adminA), true);
  check("the doctor keeps working", await isActive(doctor), true);
  check("the receptionist keeps working", await isActive(recep), true);
  check(
    "and only the suspended admin's session was cut",
    await liveSessions([adminA, adminC, doctor, recep]),
    3,
  );

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
