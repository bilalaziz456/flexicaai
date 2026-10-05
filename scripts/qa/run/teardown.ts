import { like, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { clinics, users, patients } from "@/core/db/schema";
import { unscoped } from "@/core/db/tenant-guard";

async function main() {
  await unscoped("qa teardown", async () => {
    const cs = await db.select({ id: clinics.id }).from(clinics).where(like(clinics.name, "qarun%"));
    for (const c of cs) {
      await db.delete(patients).where(eq(patients.clinicId, c.id));
      await db.delete(users).where(eq(users.clinicId, c.id));
      await db.delete(clinics).where(eq(clinics.id, c.id));
    }
    await db.delete(users).where(like(users.username, "qarun%"));
  });
  const left = await unscoped("qa teardown", async () =>
    db.select({ n: clinics.name }).from(clinics).where(like(clinics.name, "qarun%")),
  );
  console.log(`fixtures removed; qarun clinics left: ${left.length}`);
  process.exit(0);
}
void main();
