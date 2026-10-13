/**
 * Services, other charges and the deposit → settle flow (owner's call, 2026-10-13).
 *
 *  - A SERVICE line (from the Services list) bills like a procedure, takes the price
 *    typed on the bill, and earns NO doctor share; a procedure keeps its list price.
 *  - A one-off OTHER CHARGE ("Medicines Rs 2,000") is a service line with no list item.
 *  - A payment on a visit is held there IN FULL, even beyond the bill so far (a
 *    deposit at admission); revenue counts only up to the bill.
 *  - At discharge the extra is refunded, or kept as credit — a no-cash transfer that
 *    no cash figure counts, and that cancels as ONE when either half is cancelled.
 *
 * Seeds its own clinic and removes it. Run:
 * `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-services-deposit.ts`
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { appointments, clinics, patientPayments, patients, procedures, users } from "@/core/db/schema";
import {
  createProcedure,
  getAppointmentProcedureItems,
  getBookingProcedures,
  listProcedureCatalog,
  saveAppointmentProcedures,
  updateProcedure,
} from "@/core/appointments/procedures";
import { getAppointmentBill } from "@/core/billing/bill";
import { getPatientCredit, moveExtraToCredit, recordPayment, voidPayment } from "@/core/billing/payments";
import { getAppointmentShareContext } from "@/core/appointments/share-context";
import { getSalesReport, resolveSalesRange } from "@/core/sales/report";
import { getDayBook } from "@/core/finance/daybook";
import { recordSaleForAppointment } from "@/core/sales/ledger";
import { getPaymentsLedger } from "@/core/finance/payments-ledger";

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
const p2 = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

async function main() {
  await unscoped("behaviour test — seeds its own clinic", async () => {
    const tag = `sd${Date.now()}`;
    const [clinic] = await db
      .insert(clinics)
      .values({ name: tag, modulesEnabled: ["dental"], featuresEnabled: ["sales", "finance"] })
      .returning({ id: clinics.id });
    const clinicId = clinic.id;
    try {
      const [doctor] = await db
        .insert(users)
        .values({
          clinicId,
          username: `${tag}d`,
          passwordHash: "x",
          role: "doctor",
          fullName: "Deposit Doc",
          consultationFee: 0,
          consultationSharePct: 10,
          procedureSharePct: 10,
          flexibleHours: true,
        })
        .returning({ id: users.id });
      const [patient] = await db
        .insert(patients)
        .values({ clinicId, fullName: "Deposit Patient", phone: "+923001230031" })
        .returning({ id: patients.id });
      const actor = { id: doctor.id, name: "Front Desk" };

      const scalingId = await createProcedure(clinicId, { name: "Scaling", price: 5000, module: "dental" });
      const roomId = await createProcedure(clinicId, { name: "Room (per day)", price: 1500, module: null, isService: true });

      console.log("Two price lists in one table:");
      const procs = await listProcedureCatalog(clinicId);
      const svcs = await listProcedureCatalog(clinicId, "service");
      ok("Procedures lists only procedures", procs.length === 1 && procs[0].name === "Scaling");
      ok("Services lists only services", svcs.length === 1 && svcs[0].name === "Room (per day)");
      ok("plans / share overrides see procedures only", (await getBookingProcedures(clinicId)).every((p) => !p.isService));
      ok("the bill forms see both", (await getBookingProcedures(clinicId, { includeServices: true })).length === 2);
      ok(
        "the Services screen can't edit a procedure",
        !(await updateProcedure(clinicId, scalingId, { name: "X", price: 1, isActive: true }, "service")),
      );

      // An admission: started yesterday, still going.
      const at = new Date();
      at.setDate(at.getDate() - 1);
      const [appt] = await db
        .insert(appointments)
        .values({ clinicId, patientId: patient.id, doctorId: doctor.id, scheduledAt: at, status: "arrived", chargeConsultation: false })
        .returning({ id: appointments.id });
      const id = appt.id;

      console.log("\nDeposit taken before the charges are known:");
      const dep = await recordPayment(clinicId, { patientId: patient.id, appointmentId: id, amount: 10000, method: "cash", reference: null, note: null, actor });
      ok("the payment is accepted", "ok" in dep);
      let bill = await getAppointmentBill(clinicId, id);
      ok("ALL 10,000 is held on the visit (nothing split off to credit)", bill.collected === 10000, String(bill.collected));
      ok("…and the patient has no credit from it", (await getPatientCredit(clinicId, patient.id)) === 0);

      console.log("\nCharges added: a procedure, a service at a counter price, a one-off charge:");
      await saveAppointmentProcedures(clinicId, id, [
        // A typed price on a PROCEDURE is ignored — its list price stands.
        { procedureId: scalingId, quantity: 1, discountType: "amount", discountValue: 0, doctorId: doctor.id, unitPrice: 1 },
        { procedureId: roomId, quantity: 2, discountType: "amount", discountValue: 0, doctorId: doctor.id, unitPrice: 1200 },
        { procedureId: null, name: "Medicines", unitPrice: 800, quantity: 1, discountType: "amount", discountValue: 0 },
      ]);
      // What the edit action does after saving the lines (it now does so whatever the
      // visit's status — the deposit becomes revenue as the charges arrive).
      await recordSaleForAppointment(clinicId, id);
      const items = await getAppointmentProcedureItems(clinicId, id);
      const room = items.find((i) => i.name === "Room (per day)");
      const meds = items.find((i) => i.name === "Medicines");
      const scaling = items.find((i) => i.name === "Scaling");
      ok("the procedure kept its list price", scaling?.unitPrice === 5000 && !scaling.isService, JSON.stringify(scaling));
      ok("the service took the counter price", room?.unitPrice === 1200 && room.quantity === 2 && room.isService);
      ok("the service line has no performing doctor", room?.doctorId === null);
      ok("the one-off charge is a service line with no list item", meds?.isService === true && meds.procedureId === null && meds.unitPrice === 800);
      ok("procedures print first, other charges after", items[0].name === "Scaling" && items.slice(1).every((i) => i.isService));

      bill = await getAppointmentBill(clinicId, id);
      ok("bill = 5,000 + 2×1,200 + 800 = 8,200", bill.billTotal === 8200, String(bill.billTotal));

      console.log("\nDoctor share (10%):");
      const ctx = await getAppointmentShareContext(clinicId, id);
      const withShare = ctx.lines.filter((l) => l.pct > 0);
      ok("only the procedure line carries a share rate", withShare.length === 1 && withShare[0].label === "Scaling", JSON.stringify(ctx.lines));
      ok("service lines have no doctor and 0%", ctx.lines.filter((l) => l.label !== "Scaling").every((l) => l.doctorId === null && l.pct === 0));

      console.log("\nRevenue counts only up to the bill:");
      const range = resolveSalesRange("custom", ymd(at), ymd(new Date()));
      let rep = await getSalesReport(clinicId, range);
      ok("Sales = 8,200 of the 10,000 held", rep.netTotal === 8200, String(rep.netTotal));
      ok("Sales splits procedures from services", rep.byProcedure.length === 1 && rep.byService.length === 2);

      console.log("\nSettle — the bill came to less than the deposit:");
      const moved = await moveExtraToCredit(clinicId, { patientId: patient.id, appointmentId: id, actor });
      ok("Keep as credit moves the 1,800 extra", "ok" in moved && moved.moved === 1800, JSON.stringify(moved));
      bill = await getAppointmentBill(clinicId, id);
      ok("the visit now holds exactly its bill", bill.collected === 8200 && bill.outstanding === 0);
      ok("the patient has 1,800 credit", (await getPatientCredit(clinicId, patient.id)) === 1800);
      rep = await getSalesReport(clinicId, range);
      ok("revenue is unchanged by the transfer", rep.netTotal === 8200, String(rep.netTotal));
      const book = await getDayBook(clinicId, ymd(new Date()));
      ok("the day book shows no cash for the transfer (10,000 in, 0 out)", book.totals.collected === 10000 && book.totals.refunded === 0, JSON.stringify(book.totals));
      const ledger = await getPaymentsLedger(clinicId, {});
      ok("the payments totals ignore it too", ledger.totals.in === 10000 && ledger.totals.out === 0, JSON.stringify(ledger.totals));
      ok("a second Keep as credit has nothing to move", "error" in (await moveExtraToCredit(clinicId, { patientId: patient.id, appointmentId: id, actor })));

      console.log("\nCancelling one half cancels the transfer:");
      const [credit] = await db
        .select({ id: patientPayments.id })
        .from(patientPayments)
        .where(and(eq(patientPayments.clinicId, clinicId), eq(patientPayments.kind, "advance")));
      await voidPayment(clinicId, credit.id, actor);
      bill = await getAppointmentBill(clinicId, id);
      ok("the extra is back on the visit", bill.collected === 10000, String(bill.collected));
      ok("…and the credit is gone, not doubled", (await getPatientCredit(clinicId, patient.id)) === 0);
    } finally {
      for (const t of ["discount_settlements", "sale_shares", "sales", "patient_payments", "invoices", "appointment_procedures", "activity_logs", "notifications"]) {
        await db.execute(sql`delete from ${sql.identifier(t)} where clinic_id = ${clinicId}::uuid`);
      }
      await db.delete(appointments).where(eq(appointments.clinicId, clinicId));
      await db.delete(procedures).where(eq(procedures.clinicId, clinicId));
      await db.delete(patients).where(eq(patients.clinicId, clinicId));
      await db.delete(users).where(eq(users.clinicId, clinicId));
      await db.delete(clinics).where(eq(clinics.id, clinicId));
    }
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
