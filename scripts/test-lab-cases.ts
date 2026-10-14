/**
 * Lab cases (owner's call, 2026-10-15): several teeth on one case ("47, 48, 53") and
 * the lab's point of contact (name + number).
 *  - the tooth list is checked: real FDI numbers only, duplicates dropped, order kept;
 *  - the contact number follows the app-wide phone rule and is stored E.164;
 *  - a refused case writes nothing.
 * Seeds its own clinic and removes it. Run:
 * `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-lab-cases.ts`
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { clinics, patients } from "@/core/db/schema";
import { labCases } from "@/modules/dental/db/schema";
import { dentalLab } from "@/modules/dental/db/lab";
import { parseToothList } from "@/modules/dental/tooth-status";

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
  console.log("The tooth list:");
  const list = parseToothList("47, 48,53 48");
  ok("commas and spaces both separate; a repeat is dropped", "teeth" in list && list.teeth.join() === "47,48,53", JSON.stringify(list));
  ok("empty is fine (the tooth is optional)", JSON.stringify(parseToothList("")) === JSON.stringify({ teeth: [] }));
  const bad = parseToothList("47, 49, 99");
  ok("a number that is not a tooth is named", "error" in bad && bad.error.startsWith("49, 99 aren't tooth numbers"), JSON.stringify(bad));
  ok("baby teeth count (FDI 5–8)", "teeth" in parseToothList("53, 85"));

  await unscoped("behaviour test — seeds its own clinic", async () => {
    const [c] = await db.insert(clinics).values({ name: `lab${Date.now()}`, modulesEnabled: ["dental"] }).returning({ id: clinics.id });
    try {
      const [pt] = await db.insert(patients).values({ clinicId: c.id, fullName: "Lab Patient" }).returning({ id: patients.id });
      const actor = { id: pt.id, name: "Desk" };

      console.log("\nSaving:");
      const saved = await dentalLab.saveCase(c.id, pt.id, {
        item: "bridge",
        labName: "Smile Lab",
        labContactName: "  Imran  ",
        labContactPhone: "0345 1234567",
        tooth: "47 48 53",
      }, actor);
      ok("a valid case saves", !(saved && "error" in saved), JSON.stringify(saved));
      const [row] = await dentalLab.loadCases(c.id, pt.id);
      ok("teeth stored as one tidy list", row?.tooth === "47, 48, 53", row?.tooth ?? "");
      ok("contact name trimmed", row?.labContactName === "Imran");
      ok("contact number stored E.164", row?.labContactPhone === "+923451234567", row?.labContactPhone ?? "");

      const badTooth = await dentalLab.saveCase(c.id, pt.id, { item: "crown", tooth: "47, 19" }, actor);
      ok("a wrong tooth number is refused", Boolean(badTooth && "error" in badTooth));
      const badPhone = await dentalLab.saveCase(c.id, pt.id, { item: "crown", labContactPhone: "12345" }, actor);
      ok("a wrong contact number is refused", Boolean(badPhone && "error" in badPhone));
      ok("…and neither wrote a case", (await dentalLab.loadCases(c.id, pt.id)).length === 1);
      const noContact = await dentalLab.saveCase(c.id, pt.id, { item: "crown", tooth: "11" }, actor);
      ok("the contact is optional", !(noContact && "error" in noContact));
    } finally {
      await db.execute(sql`delete from activity_logs where clinic_id = ${c.id}::uuid`);
      await db.delete(labCases).where(eq(labCases.clinicId, c.id));
      await db.delete(patients).where(eq(patients.clinicId, c.id));
      await db.delete(clinics).where(eq(clinics.id, c.id));
    }
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
