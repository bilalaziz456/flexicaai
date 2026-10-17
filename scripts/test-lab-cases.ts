/**
 * Lab cases (owner's call, 2026-10-15): several teeth on one case ("47, 48, 53") and
 * the lab's point of contact (name + number).
 *  - the tooth list is checked: real FDI numbers only, duplicates dropped, order kept;
 *  - the contact number follows the app-wide phone rule and is stored E.164;
 *  - a refused case writes nothing.
 * Seeds its own clinic and removes it. Run:
 * `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-lab-cases.ts`
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { clinics, patients, treatmentPlanItems, treatmentPlans } from "@/core/db/schema";
import { labCases } from "@/modules/dental/db/schema";
import { dentalLab } from "@/modules/dental/db/lab";
import { dentalTrash } from "@/modules/dental/db/records";
import { parseToothList } from "@/modules/dental/tooth-status";
import { clinicalRecordFor } from "@/config/modules";
import { addPlanItem, createPlan, listPlans, listTreatmentPlanItems, softDeletePlan, updatePlan, updatePlanItem } from "@/core/patients/treatment-plans";
import { listClinicTrash, restoreForClinic } from "@/core/trash";

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

  console.log("\nTreatment plans get the same check through the module:");
  const parseItems = clinicalRecordFor(["dental"])?.parseItemList;
  ok("the dental module supplies it", Boolean(parseItems));
  const viaModule = parseItems?.("47 48, 53");
  ok("…and it tidies a list", Boolean(viaModule && "items" in viaModule && viaModule.items.join() === "47,48,53"));
  ok("…and refuses a wrong tooth", Boolean(parseItems && "error" in parseItems("47, 19")));

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

      // Editing a case (2026-10-18): the same checks as adding one, and the status stays.
      const editRow = (await dentalLab.loadCases(c.id, pt.id)).find((x) => x.tooth === "11")!;
      await dentalLab.updateStatus(c.id, editRow.id, "in_lab");
      const labEdited = await dentalLab.updateCase(c.id, editRow.id, { item: "bridge", tooth: "21 22", shade: "A2", note: "rush" });
      ok("an edit saves", !(labEdited && "error" in labEdited), JSON.stringify(labEdited));
      const afterEdit = (await dentalLab.loadCases(c.id, pt.id)).find((x) => x.id === editRow.id);
      ok("…with the teeth tidied and the status kept", afterEdit?.item === "bridge" && afterEdit?.tooth === "21, 22" && afterEdit?.status === "in_lab", JSON.stringify(afterEdit));
      const badEdit = await dentalLab.updateCase(c.id, editRow.id, { item: "bridge", tooth: "99" });
      ok("an edit with a wrong tooth is refused", Boolean(badEdit && "error" in badEdit));
      const otherClinic = await dentalLab.updateCase(randomUUID(), editRow.id, { item: "crown" });
      ok("another clinic cannot edit it", Boolean(otherClinic && "error" in otherClinic));

      console.log("\nA deleted lab case can be restored:");
      const [toDelete] = await dentalLab.loadCases(c.id, pt.id);
      await dentalLab.deleteCase(c.id, toDelete.id, pt.id);
      ok("delete hides it", !(await dentalLab.loadCases(c.id, pt.id)).some((x) => x.id === toDelete.id));
      const listed = (await dentalTrash.list({ kind: "clinic", clinicId: c.id, cutoff: new Date(0) })).find((t) => t.id === toDelete.id);
      ok("it is listed in Trash as a lab case", Boolean(listed?.label.endsWith("lab case")), listed?.label ?? "missing");
      if (listed) await dentalTrash.restore(listed.group, c.id);
      ok("Restore brings it back", (await dentalLab.loadCases(c.id, pt.id)).some((x) => x.id === toDelete.id));

      console.log("\nA plan item keeps the whole list:");
      const plan = await createPlan(c.id, { patientId: pt.id, module: "dental", title: "Bridge" }, actor);
      await addPlanItem(c.id, plan.id, { name: "Crown", unitPrice: 15000, tooth: "47, 48, 53", quantity: 3 });
      const [item] = await listTreatmentPlanItems(c.id, plan.id);
      ok("stored in full (it used to be cut to 4 characters)", item?.tooth === "47, 48, 53", item?.tooth ?? "");

      console.log("\nEditing and deleting a plan:");
      await updatePlan(c.id, plan.id, { title: "Lower bridge", note: "Two visits" });
      await updatePlanItem(c.id, item.id, { unitPrice: 14000, quantity: 2 });
      const [edited] = await listPlans(c.id, pt.id);
      ok("title and note change", edited?.title === "Lower bridge" && edited?.note === "Two visits");
      ok("an item's price and quantity change", edited?.items[0]?.unitPrice === 14000 && edited?.items[0]?.quantity === 2);
      await softDeletePlan(c.id, plan.id, pt.id);
      ok("delete hides it", (await listPlans(c.id, pt.id)).length === 0);
      const trash = await listClinicTrash(c.id, 30);
      const inTrash = trash.items.find((t) => t.entity === "treatment_plan" && t.id === plan.id);
      ok("it is listed in Trash as a treatment plan", Boolean(inTrash), JSON.stringify(trash.items.map((t) => t.entity)));
      if (inTrash) await restoreForClinic(c.id, inTrash.group);
      const back = await listPlans(c.id, pt.id);
      ok("Restore brings it back with its items", back.length === 1 && back[0].items.length === 1);
    } finally {
      await db.execute(sql`delete from activity_logs where clinic_id = ${c.id}::uuid`);
      await db.delete(labCases).where(eq(labCases.clinicId, c.id));
      await db.delete(treatmentPlanItems).where(eq(treatmentPlanItems.clinicId, c.id));
      await db.delete(treatmentPlans).where(eq(treatmentPlans.clinicId, c.id));
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
