/**
 * A clinic's MRN series (owner's call, 2026-10-13): the next patients follow it, the
 * patients already registered keep the MRN printed on their card, a series cannot be
 * moved back over numbers already given, and a number already held is skipped.
 * Seeds its own clinic and removes it. Run:
 * `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-mrn-series.ts`
 */
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { clinics, patients } from "@/core/db/schema";
import { createPatient, type PatientInput } from "@/core/patients/manage";
import { setClinicMrnSeries } from "@/core/patients/mrn";
import { listClinicPatients } from "@/core/patients/list";

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
const person = (fullName: string): PatientInput => ({
  fullName,
  phone: null,
  email: null,
  dateOfBirth: null,
  gender: null,
  address: null,
  reference: null,
  dataConsent: false,
});

async function main() {
  await unscoped("behaviour test — seeds its own clinic", async () => {
    const [clinic] = await db
      .insert(clinics)
      .values({ name: `mrn${Date.now()}`, modulesEnabled: ["dental"] })
      .returning({ id: clinics.id });
    const cid = clinic.id;
    try {
      console.log("Default series:");
      const a = await createPatient(cid, person("Alpha"));
      const b = await createPatient(cid, person("Bravo"));
      ok("a new clinic starts at FA-100001", a.mrnLabel === "FA-100001" && b.mrnLabel === "FA-100002", `${a.mrnLabel} ${b.mrnLabel}`);

      console.log("\nMoving to GS-00000001:");
      ok("the series is accepted", "ok" in (await setClinicMrnSeries(cid, "gs-00000001")));
      const c = await createPatient(cid, person("Charlie"));
      ok("the next patient gets GS-00000001", c.mrnLabel === "GS-00000001", c.mrnLabel);
      const [aNow] = await db.select({ l: patients.mrnLabel }).from(patients).where(eq(patients.id, a.id));
      ok("Alpha keeps FA-100001", aNow.l === "FA-100001", String(aNow.l));

      console.log("\nMoving back to FA:");
      const back = await setClinicMrnSeries(cid, "FA-100001");
      ok("FA-100001 is refused — it is already used", "error" in back);
      ok("…and the message names the first free number", "error" in back && back.error.includes("FA-100003"), JSON.stringify(back));
      ok("FA-100003 is accepted", "ok" in (await setClinicMrnSeries(cid, "FA-100003")));

      console.log("\nA number already held is skipped:");
      await db.insert(patients).values({ clinicId: cid, fullName: "Imported", mrn: 100004, mrnLabel: "FA-100004" });
      const d = await createPatient(cid, person("Delta"));
      const e = await createPatient(cid, person("Echo"));
      ok("FA-100003, then FA-100005 (FA-100004 is taken)", d.mrnLabel === "FA-100003" && e.mrnLabel === "FA-100005", `${d.mrnLabel} ${e.mrnLabel}`);

      console.log("\nOutgrowing the width:");
      await setClinicMrnSeries(cid, "AB-999");
      const f = await createPatient(cid, person("Foxtrot"));
      const g = await createPatient(cid, person("Golf"));
      ok("AB-999 continues as AB-1000", f.mrnLabel === "AB-999" && g.mrnLabel === "AB-1000", `${f.mrnLabel} ${g.mrnLabel}`);

      console.log("\nSearch finds every series:");
      const find = async (q: string) => (await listClinicPatients(cid, q, { offset: 0, limit: 10 })).rows.map((r) => r.fullName);
      ok("by full MRN GS-00000001", (await find("GS-00000001")).join() === "Charlie");
      ok("by full MRN FA-100002", (await find("FA-100002")).join() === "Bravo");
      ok("by the number alone, 100005", (await find("100005")).join() === "Echo");
      ok("by a series prefix, AB-", (await find("AB-")).sort().join() === "Foxtrot,Golf");

      console.log("\nInvalid series:");
      ok("AB-12 (two digits) is refused", "error" in (await setClinicMrnSeries(cid, "AB-12")));
      ok("FA_100001 (underscore) is refused", "error" in (await setClinicMrnSeries(cid, "FA_100001")));
    } finally {
      await db.delete(patients).where(eq(patients.clinicId, cid));
      await db.delete(clinics).where(eq(clinics.id, cid));
    }
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
