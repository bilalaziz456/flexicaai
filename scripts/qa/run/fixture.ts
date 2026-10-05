/**
 * Creates an isolated clinic with one user per role for the automated QA run.
 * Everything is prefixed `qarun` and removed by teardown.ts — no existing data
 * is touched.
 */
import { eq, like } from "drizzle-orm";
import { db } from "@/core/db";
import { clinics, users, patients } from "@/core/db/schema";
import { unscoped } from "@/core/db/tenant-guard";
import { hashPassword } from "@/core/auth/password";

// A per-run suffix. The brute-force limiter keys on the USERNAME and lives in the
// server's memory for 15 minutes, so reusing names means a previous run's lockout
// test silently breaks this run's logins for the same account.
const TAG = `qarun${Date.now().toString(36).slice(-4)}`;
export const PASSWORD = "QaRun!2345";

async function main() {
  const passwordHash = await hashPassword(PASSWORD);

  // Clean any previous run first so this is re-runnable.
  await unscoped("qa fixture", async () => {
    const old = await db.select({ id: clinics.id }).from(clinics).where(like(clinics.name, "qarun%"));
    for (const c of old) {
      await db.delete(patients).where(eq(patients.clinicId, c.id));
      await db.delete(users).where(eq(users.clinicId, c.id));
      await db.delete(clinics).where(eq(clinics.id, c.id));
    }
    await db.delete(users).where(like(users.username, "qarun%"));
  });

  const [clinic] = await unscoped("qa fixture", async () =>
    db
      .insert(clinics)
      .values({
        name: `${TAG} clinic`,
        modulesEnabled: ["dental"],
        featuresEnabled: ["sales", "finance"],
        status: "active",
      })
      .returning({ id: clinics.id }),
  );

  // A SECOND clinic, so tenant-isolation cases have somewhere to point at.
  const [other] = await unscoped("qa fixture", async () =>
    db
      .insert(clinics)
      .values({
        name: `${TAG} other clinic`,
        modulesEnabled: ["dental"],
        featuresEnabled: ["sales", "finance"],
        status: "active",
      })
      .returning({ id: clinics.id }),
  );

  const mk = async (username: string, role: string, fullName: string, clinicId: string | null) => {
    const [u] = await unscoped("qa fixture", async () =>
      db
        .insert(users)
        .values({
          clinicId,
          username,
          passwordHash,
          role: role as never,
          fullName,
          isActive: true,
          mustChangePassword: false,
        })
        .returning({ id: users.id }),
    );
    return u.id;
  };

  const ids = {
    clinicId: clinic.id,
    otherClinicId: other.id,
    clinicAdmin: await mk(`${TAG}-admin`, "clinic_admin", "QA Admin", clinic.id),
    manager: await mk(`${TAG}-manager`, "manager", "QA Manager", clinic.id),
    doctor: await mk(`${TAG}-doctor`, "doctor", "QA Doctor", clinic.id),
    receptionist: await mk(`${TAG}-recep`, "receptionist", "QA Receptionist", clinic.id),
    suspended: await mk(`${TAG}-susp`, "receptionist", "QA Suspended", clinic.id),
    // A DEDICATED account for the lockout case. The first run used the manager and
    // locked it for 15 minutes, which silently broke every later manager test and
    // produced a false Pass where an empty page looked like correct nav filtering.
    lock: await mk(`${TAG}-lock`, "receptionist", "QA Lockout Target", clinic.id),
    otherAdmin: await mk(`${TAG}-other`, "clinic_admin", "QA Other Admin", other.id),
  };

  // Suspended account, for the suspended-login case.
  await unscoped("qa fixture", async () =>
    db.update(users).set({ isActive: false }).where(eq(users.id, ids.suspended)),
  );

  const [p] = await unscoped("qa fixture", async () =>
    db
      .insert(patients)
      .values({ clinicId: clinic.id, fullName: "QA Test Patient", phone: "+923019990001" })
      .returning({ id: patients.id }),
  );
  const [op] = await unscoped("qa fixture", async () =>
    db
      .insert(patients)
      .values({ clinicId: other.id, fullName: "QA Other Patient", phone: "+923019990002" })
      .returning({ id: patients.id }),
  );

  console.log(JSON.stringify({ ...ids, patientId: p.id, otherPatientId: op.id, tag: TAG }));
  process.exit(0);
}
void main();
