/**
 * Medicines (owner's call, 2026-10-19), against the DB:
 *  - the master list refuses a second medicine of the same name, in any case;
 *  - a clinic cannot add what the master list already suggests, nor the same name twice;
 *  - a clinic's medicines are its own: another clinic never sees them;
 *  - suggestions come in order — the clinic's own, then its specialty's, then the rest —
 *    with each brand its own suggestion;
 *  - a retired master medicine and a deleted clinic medicine stop being suggested;
 *  - copying a clinic's medicine into the master list works once, and is then refused.
 * Seeds its own clinics and master rows, and removes them. Run:
 * `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-medicines.ts`
 */
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { clinicMedicines, clinics, medicines } from "@/core/db/schema";
import {
  copyClinicMedicineToMaster,
  createClinicMedicine,
  createMasterMedicine,
  deleteClinicMedicine,
  medicineSuggestions,
  setMasterMedicineActive,
} from "@/core/clinical/medicines";

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const tag = `t${Date.now()}`;
  const actor = { id: "00000000-0000-4000-8000-000000000001", name: "Test" };
  const masterIds: string[] = [];
  await unscoped("behaviour test — seeds its own clinics", async () => {
    const [a] = await db.insert(clinics).values({ name: `medA${tag}`, modulesEnabled: ["dental"] }).returning({ id: clinics.id });
    const [b] = await db.insert(clinics).values({ name: `medB${tag}`, modulesEnabled: [] }).returning({ id: clinics.id });
    try {
      console.log("Master list:");
      const general = await createMasterMedicine(
        { name: `Aaa General ${tag}`, brands: [`GenBrand${tag}`], form: "tablet", strength: "500 mg", specialties: [] },
        actor,
      );
      const dental = await createMasterMedicine(
        { name: `Zzz Dental ${tag}`, brands: [`DentBrand${tag}`], form: "mouthwash", strength: "0.2%", specialties: ["dental"] },
        actor,
      );
      if ("id" in general) masterIds.push(general.id);
      if ("id" in dental) masterIds.push(dental.id);
      ok("two medicines are added", "id" in general && "id" in dental);
      const dup = await createMasterMedicine(
        { name: `aaa general ${tag}`.toUpperCase(), brands: [], form: null, strength: null, specialties: [] },
        actor,
      );
      ok("the same name in another case is refused", "error" in dup);

      console.log("A clinic's own medicines:");
      const clash = await createClinicMedicine(a.id, { name: `Aaa General ${tag}`, brands: [], form: null, strength: null }, actor);
      ok("a clinic cannot add what the master list has", "error" in clash);
      const own = await createClinicMedicine(a.id, { name: `Mmm Own ${tag}`, brands: [`OwnBrand${tag}`], form: "syrup", strength: null }, actor);
      ok("a clinic adds its own", "id" in own);
      const again = await createClinicMedicine(a.id, { name: `mmm own ${tag}`, brands: [], form: null, strength: null }, actor);
      ok("nor the same name twice", "error" in again);

      console.log("Suggestions:");
      const mine = (await medicineSuggestions(a.id, ["dental"])).map((s) => s.value);
      const at = (v: string) => mine.indexOf(v);
      ok("the clinic's own come first", at(`Mmm Own ${tag}`) >= 0 && at(`Mmm Own ${tag}`) < at(`Zzz Dental ${tag}`));
      ok("its specialty's come before the rest", at(`Zzz Dental ${tag}`) >= 0 && at(`Zzz Dental ${tag}`) < at(`Aaa General ${tag}`));
      ok("each brand is suggested too", at(`OwnBrand${tag}`) >= 0 && at(`DentBrand${tag}`) >= 0 && at(`GenBrand${tag}`) >= 0);
      const label = (await medicineSuggestions(a.id, ["dental"])).find((s) => s.value === `DentBrand${tag}`)?.label ?? "";
      ok("a brand's label says what it is", label.includes(`Zzz Dental ${tag}`) && label.includes("mouthwash"), label);
      const theirs = (await medicineSuggestions(b.id, [])).map((s) => s.value);
      ok("another clinic never sees them", !theirs.includes(`Mmm Own ${tag}`) && theirs.includes(`Aaa General ${tag}`));

      console.log("Retire and delete:");
      if ("id" in dental) await setMasterMedicineActive(dental.id, false);
      if ("id" in own) await deleteClinicMedicine(a.id, own.id, actor.id);
      const after = (await medicineSuggestions(a.id, ["dental"])).map((s) => s.value);
      ok("a retired medicine is no longer suggested", !after.includes(`Zzz Dental ${tag}`));
      ok("a deleted clinic medicine is no longer suggested", !after.includes(`Mmm Own ${tag}`));

      console.log("Copy to the master list:");
      const extra = await createClinicMedicine(b.id, { name: `Qqq Local ${tag}`, brands: [], form: null, strength: null }, actor);
      const copied = "id" in extra ? await copyClinicMedicineToMaster(extra.id, actor) : { error: "not created" };
      if ("id" in copied) masterIds.push(copied.id);
      ok("a clinic's medicine is copied in", "id" in copied);
      const twice = "id" in extra ? await copyClinicMedicineToMaster(extra.id, actor) : { error: "x" };
      ok("and is refused the second time", "error" in twice);
    } finally {
      await db.delete(clinicMedicines).where(inArray(clinicMedicines.clinicId, [a.id, b.id]));
      if (masterIds.length) await db.delete(medicines).where(inArray(medicines.id, masterIds));
      await db.execute(sql`delete from activity_logs where clinic_id in (${a.id}::uuid, ${b.id}::uuid)`);
      await db.delete(clinics).where(eq(clinics.id, a.id));
      await db.delete(clinics).where(eq(clinics.id, b.id));
    }
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
