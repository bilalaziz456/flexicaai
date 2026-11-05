/**
 * Per-line discounts end to end (docs/per-line-discount-plan.md), against the DB:
 *  - each discount waits only on the parties that BEAR it: approving the clinic's row
 *    releases the clinic-borne line and leaves the doctor-borne one held;
 *  - a held line comes off the bill as 0 until it is approved, and a rejection keeps it 0;
 *  - a consultation discount borne by the clinic is gated by the clinic alone;
 *  - booking items from a plan puts each item's plan discount on ITS line, flagged as
 *    the plan's, and that needs no approval though the clinic requires it;
 *  - the Discounts report lists one row per discount, each with its own status.
 * Seeds its own clinic and removes it. Run:
 * `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-line-discounts.ts`
 */
import { and, eq, sql } from "drizzle-orm";
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
import { insertAppointment } from "@/core/appointments/manage";
import { decideDiscountApproval, syncDiscountApprovals } from "@/core/appointments/approvals";
import { getAppointmentShareContext } from "@/core/appointments/share-context";
import { addPlanItem, createPlan, scheduleItemsOnAppointment, updatePlanTerms } from "@/core/patients/treatment-plans";
import { getDiscountsReport } from "@/core/sales/discounts-report";
import { resolveSalesRange } from "@/core/sales/report";

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
    const [c] = await db
      .insert(clinics)
      .values({ name: `line${Date.now()}`, modulesEnabled: ["dental"], discountNeedsApproval: true })
      .returning({ id: clinics.id });
    const cid = c.id;
    try {
      const [doc] = await db
        .insert(users)
        .values({ clinicId: cid, username: `ld${Date.now()}`, passwordHash: "x", role: "doctor", fullName: "Line Doc", prefix: "Dr", consultationFee: 2000, consultationSharePct: 50, procedureSharePct: 40, discountNeedsApproval: true })
        .returning({ id: users.id });
      const [pt] = await db.insert(patients).values({ clinicId: cid, fullName: "Line Patient" }).returning({ id: patients.id });
      const [rct] = await db.insert(procedures).values({ clinicId: cid, name: "Root canal", price: 10000 }).returning({ id: procedures.id });
      const [crown] = await db.insert(procedures).values({ clinicId: cid, name: "Crown", price: 20000 }).returning({ id: procedures.id });
      const admin = { id: doc.id, name: "Approver" };

      console.log("A visit with a clinic-borne and a doctor-borne line discount:");
      const appt = await insertAppointment({
        clinicId: cid,
        patientId: pt.id,
        doctorId: doc.id,
        scheduledAt: new Date(),
        chargeConsultation: true,
        consultationDiscountType: "amount",
        consultationDiscountValue: 500,
        consultationBorneBy: "clinic",
        bearingVersion: 2,
      });
      const line = (procedureId: string, name: string, unitPrice: number, value: number, borneBy: "clinic" | "doctor") => ({
        clinicId: cid,
        appointmentId: appt.id,
        procedureId,
        name,
        unitPrice,
        quantity: 1,
        doctorId: doc.id,
        patientDiscountType: "amount" as const,
        patientDiscountValue: value,
        discountBorneBy: borneBy,
      });
      await db.insert(appointmentProcedures).values([line(rct.id, "Root canal", 10000, 1000, "clinic"), line(crown.id, "Crown", 20000, 3000, "doctor")]);

      ok("asking for approval leaves it pending", (await syncDiscountApprovals(cid, appt.id)) === "pending");
      const rows = await db.select().from(appointmentDiscountApprovals).where(eq(appointmentDiscountApprovals.appointmentId, appt.id));
      ok("one row for the clinic and one for the doctor", rows.length === 2, String(rows.length));
      const held = async () => {
        const ls = await db.select().from(appointmentProcedures).where(eq(appointmentProcedures.appointmentId, appt.id));
        const [a] = await db.select().from(appointments).where(eq(appointments.id, appt.id));
        return {
          rct: ls.find((l) => l.name === "Root canal")!.patientDiscountHeld,
          crown: ls.find((l) => l.name === "Crown")!.patientDiscountHeld,
          consult: a.consultationDiscountHeld,
        };
      };
      let h = await held();
      ok("every discount is held while waiting", h.rct && h.crown && h.consult, JSON.stringify(h));
      let ctx = await getAppointmentShareContext(cid, appt.id);
      ok("held discounts take nothing off the bill", ctx.netEffective === 32000, String(ctx.netEffective));

      const clinicRow = rows.find((r) => r.approverKind === "clinic")!;
      const doctorRow = rows.find((r) => r.approverKind === "doctor")!;
      await decideDiscountApproval(cid, clinicRow.id, "approved", admin, null);
      h = await held();
      ok("the clinic's approval releases the clinic-borne line and consultation", !h.rct && !h.consult, JSON.stringify(h));
      ok("…and leaves the doctor-borne line held", h.crown);
      ctx = await getAppointmentShareContext(cid, appt.id);
      ok("the bill takes off only what is released", ctx.netEffective === 32000 - 1000 - 500, String(ctx.netEffective));

      const report = await getDiscountsReport(cid, resolveSalesRange("today", undefined, undefined));
      const byLabel = new Map(report.rows.map((r) => [r.label, r]));
      ok("the report lists each discount on its own row", report.rows.length === 3 && byLabel.has("Consultation"), report.rows.map((r) => r.label).join(","));
      ok("each row carries its own status", byLabel.get("Root canal")?.status === "approved" && byLabel.get("Crown")?.status === "pending");
      ok("the doctor bears the crown's discount", byLabel.get("Crown")?.doctorBears === 3000 && byLabel.get("Crown")?.clinicBears === 0);
      ok("totals split applied and waiting", report.totalApplied === 1500 && report.totalPending === 3000, `${report.totalApplied}/${report.totalPending}`);

      await decideDiscountApproval(cid, doctorRow.id, "rejected", admin, null);
      h = await held();
      ok("a rejected discount stays off the bill", h.crown);
      ctx = await getAppointmentShareContext(cid, appt.id);
      ok("…while the approved ones still apply", ctx.netEffective === 30500, String(ctx.netEffective));

      console.log("\nBooking items from a plan:");
      const { id: planId } = await createPlan(cid, { patientId: pt.id, module: "dental", title: "Plan" }, admin);
      const item = await addPlanItem(cid, planId, { procedureId: rct.id, name: "Root canal", unitPrice: 10000 });
      await updatePlanTerms(cid, planId, { doctorId: doc.id, discountType: "percent", discountValue: 10, borneBy: "doctor", splitType: "percent", splitValue: 0 });
      const visit = await insertAppointment({ clinicId: cid, patientId: pt.id, doctorId: doc.id, scheduledAt: new Date(), chargeConsultation: false, bearingVersion: 2 });
      await scheduleItemsOnAppointment(cid, visit.id, [item.id]);
      const [pl] = await db.select().from(appointmentProcedures).where(and(eq(appointmentProcedures.appointmentId, visit.id)));
      ok("the plan's discount is on the line, as the plan's", pl?.patientDiscountValue === 1000 && pl.discountFromPlan && pl.discountBorneBy === "doctor", JSON.stringify({ v: pl?.patientDiscountValue, f: pl?.discountFromPlan, b: pl?.discountBorneBy }));
      const [va] = await db.select().from(appointments).where(eq(appointments.id, visit.id));
      ok("the whole-visit discount is left alone", va.discountValue === 0);
      ok("it needs no approval, though the clinic requires it", (await syncDiscountApprovals(cid, visit.id)) === "none");
      const vctx = await getAppointmentShareContext(cid, visit.id);
      ok("and it comes off the bill", vctx.netEffective === 9000, String(vctx.netEffective));
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
