/**
 * The invoice register's Payment FILTER (SQL, core/billing/payment-status-sql.ts) must
 * select exactly the invoices whose BADGE (TS, core/billing/payment-status.ts) says the
 * same — two expressions of one rule, so a test binds them (ADR-015). Also checks the
 * Outstanding card is Σ max(0, bill − collected) over the non-void invoices.
 * Runs over every clinic's real invoices. Run:
 * `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-invoice-payment-filter.ts`
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { getInvoicesList, issueInvoice } from "@/core/billing/invoice";
import { recordPayment, refund } from "@/core/billing/payments";
import { applyAppointmentStatus } from "@/core/appointments/set-status";
import { appointments, clinics, patients, users } from "@/core/db/schema";
import type { VisitPaymentStatus } from "@/core/billing/payment-status";
import { VISIT_PAYMENT_STATUSES, visitPaymentStatus } from "@/core/billing/payment-status";

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
const ALL = 100_000;

/** One visit in each of the six states, so every filter branch is exercised —
 *  real data rarely holds a refund. Bill = the doctor's Rs 1,000 fee. */
async function seededCases() {
  console.log("\nSeeded clinic — one visit per state:");
  const tag = `ipf${Date.now()}`;
  const [clinic] = await db.insert(clinics).values({ name: tag, modulesEnabled: ["dental"], featuresEnabled: ["sales"] }).returning({ id: clinics.id });
  const clinicId = clinic.id;
  try {
    const [doctor] = await db.insert(users).values({ clinicId, username: `${tag}doc`, passwordHash: "x", role: "doctor", fullName: "Filter Doc", flexibleHours: true, consultationFee: 1000 }).returning({ id: users.id });
    const [patient] = await db.insert(patients).values({ clinicId, fullName: "Filter Patient", phone: "+923001230002" }).returning({ id: patients.id });
    const actor = { id: doctor.id, name: "Test" };
    const pay = (appointmentId: string, amount: number) =>
      recordPayment(clinicId, { patientId: patient.id, appointmentId, amount, method: "cash", reference: null, note: null, actor });
    let day = 1;
    const visit = async () => {
      const when = new Date();
      when.setDate(when.getDate() + day++);
      when.setHours(10, 0, 0, 0);
      const [a] = await db.insert(appointments).values({ clinicId, patientId: patient.id, doctorId: doctor.id, scheduledAt: when, status: "scheduled" }).returning({ id: appointments.id });
      await issueInvoice(clinicId, a.id, actor);
      return a.id;
    };
    const want: [string, VisitPaymentStatus][] = [];
    want.push([await visit(), "not_paid"]);
    const adv = await visit();
    await pay(adv, 400);
    want.push([adv, "advance_paid"]);
    const part = await visit();
    await pay(part, 400);
    await applyAppointmentStatus(clinicId, part, "completed");
    want.push([part, "partially_paid"]);
    const full = await visit();
    await pay(full, 1000);
    await applyAppointmentStatus(clinicId, full, "completed");
    want.push([full, "paid"]);
    const due = await visit();
    await pay(due, 400);
    await applyAppointmentStatus(clinicId, due, "cancelled");
    want.push([due, "refund_due"]);
    const back = await visit();
    await pay(back, 400);
    await applyAppointmentStatus(clinicId, back, "cancelled");
    await refund(clinicId, { patientId: patient.id, appointmentId: back, amount: 400, method: "cash", reference: null, note: null, actor });
    want.push([back, "refunded"]);

    for (const [id, s] of want) {
      const f = await getInvoicesList(clinicId, { payment: s, limit: ALL });
      ok(`"${s}" filter finds exactly its visit`, f.count === 1 && f.rows[0]?.appointmentId === id, `${f.count} rows`);
      const row = f.rows[0];
      const b = row && visitPaymentStatus({ bill: row.amount, collected: row.collected, refunded: row.refunded, visitStatus: row.visitStatus });
      ok(`…and its badge reads "${s}"`, b === s, String(b));
    }
    const all = await getInvoicesList(clinicId, { limit: ALL });
    // Owed: not paid 1,000 + advance 600 + partial 600. The two cancelled visits'
    // invoices are void and owe nothing, even the one still holding Rs 400.
    ok("Outstanding card = Rs 2,200 (cancelled visits owe nothing)", all.totalOutstanding === 2200, String(all.totalOutstanding));
    // Taken: 400 + 400 + 1,000 + 400 + 400 = 2,600; given back: 400.
    ok("Money in card = Rs 2,600 (before refunds, cancelled visits included)", all.moneyIn === 2600, String(all.moneyIn));
    ok("Refunds card = Rs 400", all.refunds === 400, String(all.refunds));
    ok("Net card = Rs 2,200 (in − refunds)", all.net === 2200, String(all.net));
  } finally {
    for (const t of ["notifications", "activity_logs", "whatsapp_messages", "patient_payments", "invoices", "sales", "sale_shares", "discount_settlements"]) {
      await db.execute(sql`delete from ${sql.identifier(t)} where clinic_id = ${clinicId}::uuid`);
    }
    await db.delete(appointments).where(eq(appointments.clinicId, clinicId));
    await db.delete(patients).where(eq(patients.clinicId, clinicId));
    await db.delete(users).where(eq(users.clinicId, clinicId));
    await db.delete(clinics).where(eq(clinics.id, clinicId));
  }
}

async function main() {
  await unscoped("behaviour test — seeds its own clinic", seededCases);
  await unscoped("behaviour test — reads every clinic's own invoices", async () => {
    const res = await db.execute(sql`select distinct clinic_id::text as id from invoices where deleted_at is null`);
    const clinicIds = (res.rows as { id: string }[]).map((r) => r.id);
    if (clinicIds.length === 0) console.log("(no invoices in this database)");
    for (const clinicId of clinicIds) {
      const all = await getInvoicesList(clinicId, { limit: ALL });
      const badge = (r: (typeof all.rows)[number]) =>
        visitPaymentStatus({ bill: r.amount, collected: r.collected, refunded: r.refunded, visitStatus: r.visitStatus });
      console.log(`\nClinic ${clinicId.slice(0, 8)} — ${all.count} invoices:`);
      let covered = 0;
      for (const s of VISIT_PAYMENT_STATUSES) {
        const f = await getInvoicesList(clinicId, { payment: s, limit: ALL });
        const expected = all.rows.filter((r) => badge(r) === s).length;
        const wrong = f.rows.filter((r) => badge(r) !== s);
        covered += f.count;
        ok(`"${s}" filter: ${f.count} invoices, all carrying that badge`, f.count === expected && wrong.length === 0, `filter ${f.count}, badges ${expected}, mismatched ${wrong.map((r) => r.label).join(", ")}`);
      }
      const noBadge = all.rows.filter((r) => badge(r) === null).length;
      ok("every invoice falls under exactly one filter (or has no badge)", covered + noBadge === all.count, `${covered} + ${noBadge} ≠ ${all.count}`);
      const owed = all.rows.filter((r) => !r.voided).reduce((n, r) => n + Math.max(0, r.amount - r.collected), 0);
      ok(`Outstanding card = Rs ${all.totalOutstanding}, the sum of what each invoice still owes`, owed === all.totalOutstanding, `rows sum to ${owed}`);
      const net = all.rows.reduce((n, r) => n + r.collected, 0);
      const back = all.rows.reduce((n, r) => n + r.refunded, 0);
      ok(`Money in / Refunds / Net cards (Rs ${all.moneyIn} / ${all.refunds} / ${all.net}) agree with the rows`, all.net === net && all.refunds === back && all.moneyIn === net + back, `rows: net ${net}, refunds ${back}`);
    }
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
