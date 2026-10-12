/**
 * Revenue follows the MONEY (owner's call, 2026-10-13): a payment counts on the day
 * it is received, whatever the visit's status; the doctor's share follows it; a refund
 * comes off on its own date; and a visit "owes" money once its time has passed (not
 * when someone presses Complete). Pure checks first, then the real ledger on a seeded
 * clinic. Run:
 * `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-money-days.ts`
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { appointments, clinics, patientPayments, patients, saleShares, sales, users } from "@/core/db/schema";
import { moneyDaysFrom } from "@/core/sales/money-days";
import { recordSaleForAppointment } from "@/core/sales/ledger";
import { getOutstandingTotal } from "@/core/finance/receivables";
import { getProfitAndLoss } from "@/core/finance/pl";
import { getAppointmentBill } from "@/core/billing/bill";
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
const day = (offset: number, h = 11) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(h, 0, 0, 0);
  return d;
};

async function main() {
  console.log("Folding a visit's payments into days (pure):");
  {
    const e = [
      { kind: "payment", amount: 2000, occurredAt: day(-3) },
      { kind: "payment", amount: 2000, occurredAt: day(-2) },
      { kind: "refund", amount: 1000, occurredAt: day(-1) },
      { kind: "payment", amount: 1000, occurredAt: day(0) },
    ];
    const d = moneyDaysFrom(e, 4000);
    ok("one entry per day money moved", d.length === 4, JSON.stringify(d.map((x) => x.delta)));
    ok("+2000, +2000, −1000, +1000", d.map((x) => x.delta).join(",") === "2000,2000,-1000,1000");
    ok("they add up to what was kept: 4000", d.reduce((n, x) => n + x.delta, 0) === 4000);
    const same = moneyDaysFrom(
      [
        { kind: "payment", amount: 500, occurredAt: day(0, 9) },
        { kind: "payment", amount: 700, occurredAt: day(0, 15) },
      ],
      4000,
    );
    ok("two payments on one day are one entry", same.length === 1 && same[0].delta === 1200);
    const over = moneyDaysFrom([{ kind: "payment", amount: 5000, occurredAt: day(0) }], 4000);
    ok("never books more than the bill", over.length === 1 && over[0].delta === 4000);
  }

  await unscoped("behaviour test — seeds its own clinic", async () => {
    const tag = `md${Date.now()}`;
    const [clinic] = await db.insert(clinics).values({ name: tag, modulesEnabled: ["dental"], featuresEnabled: ["sales"] }).returning({ id: clinics.id });
    const clinicId = clinic.id;
    try {
      const [doctor] = await db
        .insert(users)
        .values({ clinicId, username: `${tag}d`, passwordHash: "x", role: "doctor", fullName: "Money Doc", consultationFee: 4000, consultationSharePct: 10 })
        .returning({ id: users.id });
      const [patient] = await db.insert(patients).values({ clinicId, fullName: "Money Patient", phone: "+923001230011" }).returning({ id: patients.id });
      const visit = async (when: Date, status: "scheduled" | "completed") =>
        (await db.insert(appointments).values({ clinicId, patientId: patient.id, doctorId: doctor.id, scheduledAt: when, status }).returning({ id: appointments.id }))[0].id;
      const money = async (appointmentId: string, kind: "payment" | "refund", amount: number, at: Date) => {
        await db.insert(patientPayments).values({ clinicId, patientId: patient.id, appointmentId, kind, amount, method: "cash", occurredAt: at });
        const [{ c }] = (await db.execute(sql`select coalesce(sum(case when kind_id = 4 then -amount else amount end),0)::int c from patient_payments where appointment_id = ${appointmentId}::uuid and deleted_at is null and kind_id in (1,3,4)`)).rows as { c: number }[];
        await db.update(appointments).set({ amountCollected: c }).where(eq(appointments.id, appointmentId));
        await recordSaleForAppointment(clinicId, appointmentId);
      };

      console.log("\nA visit paid over four days, never marked Completed:");
      const a = await visit(day(-3), "scheduled");
      await money(a, "payment", 2000, day(-3));
      await money(a, "payment", 2000, day(-2));
      await money(a, "refund", 1000, day(-1));
      await money(a, "payment", 1000, day(0));
      const rows = await db.select().from(sales).where(eq(sales.appointmentId, a));
      ok("revenue is recorded although the visit is only Scheduled", rows.length > 0);
      ok("one sale row per day money moved", rows.length === 4, String(rows.length));
      ok("revenue adds up to Rs 4,000", rows.reduce((n, r) => n + r.netAmount, 0) === 4000);
      const refundRow = rows.find((r) => r.netAmount < 0);
      ok("the refund comes off on its own date", refundRow?.netAmount === -1000 && refundRow.occurredAt.toDateString() === day(-1).toDateString());
      const shares = await db.select().from(saleShares).where(eq(saleShares.appointmentId, a));
      ok("the doctor's 10% follows the money: 200, 200, −100, 100", shares.map((s) => s.shareAmount).sort((x, y) => x - y).join(",") === "-100,100,200,200", shares.map((s) => s.shareAmount).join(","));
      const bill = await getAppointmentBill(clinicId, a);
      ok("the payment panel calls it Paid (no 'deposit' state)", bill.paymentStatus === "paid", bill.paymentStatus);

      console.log("\nToday's figures show today's money:");
      const pl = await getProfitAndLoss(clinicId, resolveSalesRange("today", undefined, undefined));
      ok("today's revenue is today's Rs 1,000 payment", pl.revenue === 1000, String(pl.revenue));

      console.log("\nWho owes money:");
      const past = await visit(day(-1), "scheduled"); // happened, nobody pressed Complete
      const future = await visit(day(3), "scheduled"); // next week
      const cancelled = await visit(day(-1), "scheduled");
      await db.update(appointments).set({ status: "cancelled" }).where(eq(appointments.id, cancelled));
      void past;
      void future;
      const owed = await getOutstandingTotal(clinicId);
      ok("a past visit nobody completed owes its Rs 4,000; a future or cancelled one owes nothing", owed === 4000, String(owed));

      console.log("\nA cancelled visit keeps its money until it is refunded:");
      const c2 = await visit(day(-1), "scheduled");
      await money(c2, "payment", 1500, day(-1));
      await db.update(appointments).set({ status: "cancelled" }).where(eq(appointments.id, c2));
      await recordSaleForAppointment(clinicId, c2);
      const kept = (await db.select().from(sales).where(eq(sales.appointmentId, c2))).reduce((n, r) => n + r.netAmount, 0);
      ok("still Rs 1,500 in revenue while not refunded", kept === 1500, String(kept));
      await money(c2, "refund", 1500, day(0));
      const after = (await db.select().from(sales).where(eq(sales.appointmentId, c2))).reduce((n, r) => n + r.netAmount, 0);
      ok("refunding it takes it back to zero", after === 0, String(after));
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
