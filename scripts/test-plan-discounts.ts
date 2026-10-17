/**
 * Treatment-plan discounts end to end (owner's call, 2026-10-18), against the DB:
 *  - an item SNAPSHOTS the clinic offer running when it is added; "Remove offer" drops it;
 *  - a doctor or split discount needs the plan's doctor;
 *  - booking items from the plan books each line with the visit's doctor and the
 *    item's offer, and the visit takes the plan's discount;
 *  - that discount needs NO approval even where the clinic requires approval for
 *    discounts — and a discount the desk changes does.
 * Seeds its own clinic and removes it. Run:
 * `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-plan-discounts.ts`
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import {
  appointmentDiscountApprovals,
  appointmentProcedures,
  appointments,
  clinics,
  patients,
  procedures,
  treatmentPlanItems,
  treatmentPlans,
  users,
} from "@/core/db/schema";
import {
  addPlanItem,
  createPlan,
  listPlans,
  planBillOf,
  planDiscountForItems,
  scheduleItemsOnAppointment,
  updatePlanItem,
  updatePlanTerms,
} from "@/core/patients/treatment-plans";
import { isPlanDiscount } from "@/core/patients/plan-bill";
import { insertAppointment } from "@/core/appointments/manage";
import { syncDiscountApprovals } from "@/core/appointments/approvals";

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
  await unscoped("behaviour test — seeds its own clinic", async () => {
    // The clinic AND the doctor require approval for discounts — the plan's must still go through.
    const [c] = await db
      .insert(clinics)
      .values({ name: `plan${Date.now()}`, modulesEnabled: ["dental"], discountNeedsApproval: true })
      .returning({ id: clinics.id });
    const cid = c.id;
    try {
      const [doc] = await db
        .insert(users)
        .values({ clinicId: cid, username: `pd${Date.now()}`, passwordHash: "x", role: "doctor", fullName: "Plan Doc", prefix: "Dr", consultationFee: 0, procedureSharePct: 40, discountNeedsApproval: true })
        .returning({ id: users.id });
      const [pt] = await db.insert(patients).values({ clinicId: cid, fullName: "Plan Patient" }).returning({ id: patients.id });
      const [rct] = await db
        .insert(procedures)
        .values({ clinicId: cid, name: "Root canal", price: 10000, offerType: "percent", offerValue: 10 })
        .returning({ id: procedures.id });
      const [crown] = await db.insert(procedures).values({ clinicId: cid, name: "Crown", price: 20000 }).returning({ id: procedures.id });
      const actor = { id: doc.id, name: "Front Desk" };

      console.log("Items and offers:");
      const { id: planId } = await createPlan(cid, { patientId: pt.id, module: "dental", title: "Full mouth" }, actor);
      const a = await addPlanItem(cid, planId, { procedureId: rct.id, name: "Root canal", unitPrice: 10000 });
      const b = await addPlanItem(cid, planId, { procedureId: crown.id, name: "Crown", unitPrice: 20000 });
      let plan = (await listPlans(cid, pt.id))[0];
      const itemA = plan.items.find((i) => i.id === a.id)!;
      ok("the running offer is snapshotted onto the item", itemA.offerType === "percent" && itemA.offerValue === 10);
      ok("a procedure with no offer gets none", plan.items.find((i) => i.id === b.id)!.offerValue === 0);

      await updatePlanItem(cid, b.id, { discount: { type: "amount", value: 2000 } });
      ok("a doctor discount needs the plan's doctor", "error" in (await updatePlanTerms(cid, planId, { doctorId: null, discountType: "percent", discountValue: 10, borneBy: "doctor", splitType: "percent", splitValue: 0 })));
      ok(
        "with the doctor chosen it saves",
        "ok" in (await updatePlanTerms(cid, planId, { doctorId: doc.id, discountType: "percent", discountValue: 10, borneBy: "doctor", splitType: "percent", splitValue: 0 })),
      );

      plan = (await listPlans(cid, pt.id))[0];
      const bill = planBillOf(plan, plan.items);
      // Root canal 10,000 − 10% offer = 9,000; crown 20,000 − 2,000 = 18,000; subtotal
      // 27,000; overall 10% = 2,700; total 24,300.
      ok("the plan's totals", bill.subtotal === 27000 && bill.overallDiscount === 2700 && bill.total === 24300, JSON.stringify(bill));

      console.log("\nBooking the root canal from the plan:");
      const fromPlan = await planDiscountForItems(cid, [a.id]);
      const expected = bill.items[plan.items.findIndex((i) => i.id === a.id)].planDiscount;
      ok("it carries the item's share of the plan discount, by the doctor", Boolean(fromPlan && !("error" in fromPlan) && fromPlan.amount === expected && fromPlan.borneBy === "doctor"), JSON.stringify(fromPlan));
      const terms = fromPlan && !("error" in fromPlan) ? fromPlan : null;
      const asBooked = { discountType: "amount" as const, discountValue: terms?.amount ?? 0, borneBy: "doctor", splitType: "percent" as const, splitValue: 0 };
      ok("the form's unchanged discount is recognised as the plan's", isPlanDiscount(terms, asBooked));
      ok("…and a changed one is not", !isPlanDiscount(terms, { ...asBooked, discountValue: asBooked.discountValue + 100 }));

      const appt = await insertAppointment({
        clinicId: cid,
        patientId: pt.id,
        doctorId: doc.id,
        scheduledAt: new Date(),
        chargeConsultation: false,
        discountType: "amount",
        discountValue: asBooked.discountValue,
        discountBorneBy: "doctor",
        discountFromPlan: true,
      });
      await scheduleItemsOnAppointment(cid, appt.id, [a.id]);
      const [line] = await db.select().from(appointmentProcedures).where(eq(appointmentProcedures.appointmentId, appt.id));
      ok("the line has the visit's doctor (who earns its share)", line?.doctorId === doc.id);
      ok("the line carries the item's offer as its discount", line?.discountType === "percent" && line?.discountValue === 10);
      ok("the plan's discount needs no approval, though the clinic requires it", (await syncDiscountApprovals(cid, appt.id)) === "none");

      await db.update(appointments).set({ discountFromPlan: false }).where(eq(appointments.id, appt.id));
      ok("once it is an ordinary discount, the doctor's approval applies", (await syncDiscountApprovals(cid, appt.id)) === "pending");
    } finally {
      await db.execute(sql`delete from activity_logs where clinic_id = ${cid}::uuid`);
      await db.execute(sql`delete from notifications where clinic_id = ${cid}::uuid`);
      await db.delete(appointmentDiscountApprovals).where(eq(appointmentDiscountApprovals.clinicId, cid));
      await db.delete(appointmentProcedures).where(eq(appointmentProcedures.clinicId, cid));
      await db.delete(treatmentPlanItems).where(eq(treatmentPlanItems.clinicId, cid));
      await db.delete(treatmentPlans).where(eq(treatmentPlans.clinicId, cid));
      await db.delete(appointments).where(eq(appointments.clinicId, cid));
      await db.delete(procedures).where(eq(procedures.clinicId, cid));
      await db.delete(patients).where(eq(patients.clinicId, cid));
      await db.delete(users).where(eq(users.clinicId, cid));
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
