/**
 * "A payment shows everywhere" — the owner's check after ADR-035 (2026-10-13): book a
 * visit (never marked Completed), take a payment through the same core functions the
 * screens use, and assert EVERY screen's own reader sees it: the payment panel, the
 * appointments list, the invoice register, the payments ledger, the day book, the
 * cash drawer, the patient's account, Sales, the P&L, the doctor's share, the
 * dashboard — and that Receivables / Outstanding follow the time-has-passed rule.
 * Seeds its own clinic and removes it. Run:
 * `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-payment-everywhere.ts`
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { appointments, clinics, patients, users } from "@/core/db/schema";
import { recordPayment } from "@/core/billing/payments";
import { confirmAppointmentOnPayment } from "@/core/appointments/set-status";
import { autoIssueInvoice, getInvoicesList } from "@/core/billing/invoice";
import { getAppointmentBill } from "@/core/billing/bill";
import { buildAppointmentConds, listClinicAppointments } from "@/core/appointments/list-query";
import { visitPaymentStatus } from "@/core/billing/payment-status";
import { getPaymentsLedger } from "@/core/finance/payments-ledger";
import { getDayBook } from "@/core/finance/daybook";
import { getDrawerState } from "@/core/finance/petty-cash";
import { getPatientAccount } from "@/core/billing/account";
import { getSalesReport, resolveSalesRange } from "@/core/sales/report";
import { getProfitAndLoss } from "@/core/finance/pl";
import { getDoctorBalances } from "@/core/sales/payouts";
import { getFinanceKpis } from "@/core/finance/kpis";
import { getOutstandingTotal, getReceivablesReport } from "@/core/finance/receivables";

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
    const tag = `pe${Date.now()}`;
    const [clinic] = await db
      .insert(clinics)
      .values({ name: tag, modulesEnabled: ["dental"], featuresEnabled: ["sales", "finance"] })
      .returning({ id: clinics.id });
    const clinicId = clinic.id;
    try {
      const [doctor] = await db
        .insert(users)
        .values({ clinicId, username: `${tag}d`, passwordHash: "x", role: "doctor", fullName: "Everywhere Doc", consultationFee: 3500, consultationSharePct: 10, flexibleHours: true })
        .returning({ id: users.id });
      const [patient] = await db
        .insert(patients)
        .values({ clinicId, fullName: "Everywhere Patient", phone: "+923001230021" })
        .returning({ id: patients.id });
      const actor = { id: doctor.id, name: "Front Desk" };

      // A visit still AHEAD (two hours from now), booked and never completed — the
      // owner's case. Not a fixed "23:00 today": after 11 pm that is in the past.
      const later = new Date(Date.now() + 2 * 3600_000);
      const [appt] = await db
        .insert(appointments)
        .values({ clinicId, patientId: patient.id, doctorId: doctor.id, scheduledAt: later, status: "scheduled" })
        .returning({ id: appointments.id });
      const id = appt.id;
      await autoIssueInvoice(clinicId, id, actor); // what booking does

      // The payment, exactly as the payment section / New appointment take it.
      const paid = await recordPayment(clinicId, {
        patientId: patient.id,
        appointmentId: id,
        amount: 1000,
        method: "cash",
        reference: null,
        note: null,
        actor,
      });
      ok("the payment is accepted", "ok" in paid, JSON.stringify(paid));
      await confirmAppointmentOnPayment(clinicId, id);

      console.log("\nThe visit itself:");
      const bill = await getAppointmentBill(clinicId, id);
      ok("payment section: Bill 3,500 · Collected 1,000 · Outstanding 2,500", bill.billTotal === 3500 && bill.collected === 1000 && bill.outstanding === 2500, JSON.stringify(bill));
      ok("no 'deposit' state — it is a part payment", bill.paymentStatus === "partial", bill.paymentStatus);
      ok("taking money confirmed the appointment", bill.status === "confirmed", bill.status);

      // A window around the visit, which may fall on tomorrow late at night.
      const from = new Date(Date.now() - 86_400_000);
      const to = new Date(Date.now() + 2 * 86_400_000);
      const list = await listClinicAppointments(clinicId, buildAppointmentConds({ start: from, endExclusive: to }), { offset: 0, limit: 10 });
      const row = list.rows.find((r) => r.id === id);
      const badge = row && visitPaymentStatus({ bill: 3500, collected: row.amountCollected, refunded: Number(row.refunded), visitStatus: row.status });
      ok("Appointments list badge: Advance paid", badge === "advance_paid", String(badge));

      console.log("\nFinance screens:");
      const inv = await getInvoicesList(clinicId, { limit: 50 });
      const invRow = inv.rows.find((r) => r.appointmentId === id);
      ok("Invoices: the invoice shows Rs 1,000 collected", invRow?.collected === 1000);
      ok("Invoices: Money in includes it", inv.moneyIn === 1000, String(inv.moneyIn));
      const ledger = await getPaymentsLedger(clinicId, {});
      ok("Payments: a Rs 1,000 row against its invoice #", ledger.rows.some((r) => r.amount === 1000 && Boolean(r.invoiceLabel)) && ledger.totals.in === 1000);
      const daybook = await getDayBook(clinicId, ymd(new Date()));
      ok("Day book: today's collected is Rs 1,000", daybook.totals.collected === 1000, String(daybook.totals.collected));
      const drawer = await getDrawerState(clinicId);
      ok("Petty cash: the drawer expects Rs 1,000 more cash", drawer.movement.collected === 1000, String(drawer.movement.collected));
      const account = await getPatientAccount(clinicId, patient.id);
      ok("Patient profile: Collected 1,000, Outstanding 2,500 (upcoming)", account.totals.collected === 1000 && account.totals.outstanding === 2500 && account.totals.upcoming === 2500, JSON.stringify(account.totals));

      console.log("\nRevenue (counts today, the day it was received):");
      const today = resolveSalesRange("today", undefined, undefined);
      const salesRep = await getSalesReport(clinicId, today);
      ok("Sales: Rs 1,000 from 1 visit", salesRep.netTotal === 1000 && salesRep.count === 1, `${salesRep.netTotal} / ${salesRep.count}`);
      const pl = await getProfitAndLoss(clinicId, today);
      ok("P&L: revenue Rs 1,000, doctor share Rs 100", pl.revenue === 1000 && pl.doctorShares === 100, `${pl.revenue} / ${pl.doctorShares}`);
      const bal = (await getDoctorBalances(clinicId)).find((b) => b.doctorId === doctor.id);
      ok("Revenue shares: the doctor has earned Rs 100", bal?.earned === 100, String(bal?.earned));
      const kpis = await getFinanceKpis(clinicId);
      ok("Dashboard: Collected (30d) includes the Rs 1,000", kpis.collected30d === 1000, String(kpis.collected30d));

      console.log("\nWho owes money:");
      ok("Receivables: nothing yet — the visit is still ahead", (await getOutstandingTotal(clinicId)) === 0);
      // The same visit once its time has passed (still never marked Completed).
      const past = new Date();
      past.setHours(past.getHours() - 1);
      await db.update(appointments).set({ scheduledAt: past }).where(eq(appointments.id, id));
      ok("Receivables: once its time has passed it owes Rs 2,500", (await getOutstandingTotal(clinicId)) === 2500);
      const rec = await getReceivablesReport(clinicId);
      ok("…and the Receivables report lists the patient", rec.total === 2500 && rec.patientCount === 1, `${rec.total} / ${rec.patientCount}`);
      const kpis2 = await getFinanceKpis(clinicId);
      ok("…and the dashboard's Outstanding agrees", kpis2.outstandingReceivable === 2500, String(kpis2.outstandingReceivable));
    } finally {
      for (const t of ["discount_settlements", "sale_shares", "sales", "patient_payments", "invoices", "activity_logs", "notifications", "whatsapp_messages"]) {
        await db.execute(sql`delete from ${sql.identifier(t)} where clinic_id = ${clinicId}::uuid`);
      }
      await db.delete(appointments).where(eq(appointments.clinicId, clinicId));
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
