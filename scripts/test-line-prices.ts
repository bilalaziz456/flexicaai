/**
 * Changing a procedure's price on one bill (docs/line-price-plan.md), against the DB:
 *  - a typed price is what is charged, and the list price is kept beside it;
 *  - a changed price is FINAL: the clinic offer does not come off it; the doctor's
 *    share is on the charged price; back at the list price, the offer applies again;
 *  - an edit that sends no price keeps the booked one, even after the list price moved;
 *  - re-pricing keeps the list price from first booking, and reports the change;
 *  - a lowered price is not a discount: no approval, nothing in the Discounts report,
 *    but a row in the Price changes report;
 *  - a line from before 0140 (no list price) never shows as changed;
 *  - who may change a price: `bill_price:edit`, clinic admin only by default.
 * Seeds its own clinic and removes it. Run:
 * `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-line-prices.ts`
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
  users,
} from "@/core/db/schema";
import { insertAppointment } from "@/core/appointments/manage";
import { getAppointmentProcedureItems, saveAppointmentProcedures } from "@/core/appointments/procedures";
import { syncDiscountApprovals } from "@/core/appointments/approvals";
import { getAppointmentShareContext } from "@/core/appointments/share-context";
import { getDiscountsReport } from "@/core/sales/discounts-report";
import { getPriceChangesReport } from "@/core/sales/price-changes-report";
import { resolveSalesRange } from "@/core/sales/report";
import { can, defaultPermissionsForRole } from "@/core/auth/permissions";

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

function permissionChecks() {
  console.log("Who may change a price (bill_price:edit):");
  ok("a clinic admin, by default", can({ role: "clinic_admin" }, "bill_price", "edit"));
  for (const role of ["manager", "receptionist", "doctor"] as const) {
    ok(`not a ${role}, by default`, !can({ role }, "bill_price", "edit"));
  }
  ok(
    "a receptionist the admin ticked it for",
    can({ role: "receptionist", permissions: [...defaultPermissionsForRole("receptionist"), "bill_price:edit"] }, "bill_price", "edit"),
  );
  ok(
    "nobody, where the super admin took it from the clinic",
    !can({ role: "clinic_admin", capabilities: ["appointments:create", "appointments:edit"] }, "bill_price", "edit"),
  );
  console.log("");
}

async function main() {
  permissionChecks();
  await unscoped("behaviour test — seeds its own clinic", async () => {
    const [c] = await db
      .insert(clinics)
      .values({ name: `price${Date.now()}`, modulesEnabled: ["dental"], discountNeedsApproval: true })
      .returning({ id: clinics.id });
    const cid = c.id;
    try {
      const [doc] = await db
        .insert(users)
        .values({ clinicId: cid, username: `lp${Date.now()}`, passwordHash: "x", role: "doctor", fullName: "Price Doc", prefix: "Dr", consultationFee: 0, procedureSharePct: 40, discountNeedsApproval: true })
        .returning({ id: users.id });
      const [pt] = await db.insert(patients).values({ clinicId: cid, fullName: "Price Patient" }).returning({ id: patients.id });
      const [rct] = await db.insert(procedures).values({ clinicId: cid, name: "Root canal", price: 5000 }).returning({ id: procedures.id });
      const appt = await insertAppointment({ clinicId: cid, patientId: pt.id, doctorId: doc.id, scheduledAt: new Date(), chargeConsultation: false, bearingVersion: 2 });
      const line = (unitPrice?: number) => ({
        procedureId: rct.id,
        quantity: 1,
        discountType: "percent" as const,
        discountValue: 10,
        doctorId: doc.id,
        ...(unitPrice !== undefined ? { unitPrice } : {}),
      });

      console.log("Raised to Rs 6,000 with a 10% offer:");
      let changes = await saveAppointmentProcedures(cid, appt.id, [line(6000)]);
      let [item] = await getAppointmentProcedureItems(cid, appt.id);
      ok("charged 6,000, list 5,000 kept beside it", item.unitPrice === 6000 && item.listPrice === 5000, JSON.stringify(item));
      ok("the change is reported for the log", changes.length === 1 && changes[0].unitPrice === 6000 && changes[0].listPrice === 5000);
      const ctx = await getAppointmentShareContext(cid, appt.id);
      ok("no offer comes off a changed price", item.discountValue === 0 && ctx.netEffective === 6000, String(ctx.netEffective));
      ok("the doctor's share is on the charged price", ctx.lines[0]?.gross === 6000 && ctx.lines[0]?.pct === 40, JSON.stringify(ctx.lines));

      await saveAppointmentProcedures(cid, appt.id, [line(5000)]);
      [item] = await getAppointmentProcedureItems(cid, appt.id);
      ok("back at the list price, the offer applies again", item.discountValue === 10 && item.unitPrice === 5000);
      await saveAppointmentProcedures(cid, appt.id, [line(6000)]);

      console.log("\nThe list price rises to Rs 5,500, then the visit is edited with no price:");
      await db.update(procedures).set({ price: 5500 }).where(eq(procedures.id, rct.id));
      changes = await saveAppointmentProcedures(cid, appt.id, [line()]);
      [item] = await getAppointmentProcedureItems(cid, appt.id);
      ok("the booked price stands", item.unitPrice === 6000, String(item.unitPrice));
      ok("the list price is the one it was booked at", item.listPrice === 5000, String(item.listPrice));
      ok("nothing new to log", changes.length === 0);

      console.log("\nLowered to Rs 4,000:");
      changes = await saveAppointmentProcedures(cid, appt.id, [line(4000)]);
      [item] = await getAppointmentProcedureItems(cid, appt.id);
      ok("charged 4,000", item.unitPrice === 4000 && item.listPrice === 5000);
      ok("the change is reported", changes.length === 1 && changes[0].unitPrice === 4000);
      ok("a lower price asks no approval, though the clinic requires it for discounts", (await syncDiscountApprovals(cid, appt.id)) === "none");
      const today = resolveSalesRange("today", undefined, undefined);
      ok("it is not in the Discounts report", (await getDiscountsReport(cid, today)).rows.length === 0);
      const pc = await getPriceChangesReport(cid, today);
      ok("it is in the Price changes report", pc.count === 1 && pc.rows[0].difference === -1000 && pc.lowered === 1000 && pc.raised === 0, JSON.stringify(pc));

      console.log("\nA new line takes today's list price; an old line is never 'changed':");
      const fresh = await insertAppointment({ clinicId: cid, patientId: pt.id, doctorId: doc.id, scheduledAt: new Date(), chargeConsultation: false, bearingVersion: 2 });
      await saveAppointmentProcedures(cid, fresh.id, [{ ...line(), discountValue: 0 }]);
      const [f] = await getAppointmentProcedureItems(cid, fresh.id);
      ok("billed at the list price, which is recorded", f.unitPrice === 5500 && f.listPrice === 5500);
      await db.update(appointmentProcedures).set({ listPrice: null, unitPrice: 7000 }).where(eq(appointmentProcedures.appointmentId, fresh.id));
      ok("a line with no list price recorded does not show", (await getPriceChangesReport(cid, today)).count === 1);
    } finally {
      await db.execute(sql`delete from activity_logs where clinic_id = ${cid}::uuid`);
      await db.execute(sql`delete from notifications where clinic_id = ${cid}::uuid`);
      await db.delete(appointmentDiscountApprovals).where(eq(appointmentDiscountApprovals.clinicId, cid));
      await db.delete(appointmentProcedures).where(eq(appointmentProcedures.clinicId, cid));
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
