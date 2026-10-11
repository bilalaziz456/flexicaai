/**
 * AUTOMATIC INVOICE NUMBERS (owner's call, 2026-10-12): a staff booking gets its
 * invoice number at booking; a WhatsApp request gets one only when the front desk
 * confirms it; a cancelled or no-show visit's invoice is VOID with its number kept,
 * and bringing the visit back restores the SAME number; leave cancellations void too;
 * a clinic without billing gets none.
 *
 * Seeds its own clinics and removes them. Run:
 * `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-invoice-auto.ts`
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { appointments, clinics, invoices, patients, users } from "@/core/db/schema";
import { autoIssueInvoice, getInvoiceForAppointment } from "@/core/billing/invoice";
import { applyAppointmentStatus } from "@/core/appointments/set-status";
import { addDoctorLeave } from "@/core/appointments/leave";
import { recordPayment } from "@/core/billing/payments";

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
const tag = `ia${Date.now()}`;
const day = (offset: number, h = 10) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(h, 0, 0, 0);
  return d;
};
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function seedClinic(features: string[]) {
  const [clinic] = await db
    .insert(clinics)
    .values({ name: `${tag}${features.length}`, modulesEnabled: ["dental"], featuresEnabled: features })
    .returning({ id: clinics.id });
  const [doctor] = await db
    .insert(users)
    .values({ clinicId: clinic.id, username: `${tag}${features.length}doc`, passwordHash: "x", role: "doctor", fullName: "Inv Doc", flexibleHours: true, consultationFee: 1000 })
    .returning({ id: users.id });
  const [patient] = await db
    .insert(patients)
    .values({ clinicId: clinic.id, fullName: "Inv Patient", phone: "+923001230001" })
    .returning({ id: patients.id });
  return { clinicId: clinic.id, doctorId: doctor.id, patientId: patient.id };
}

async function main() {
  const created: string[] = [];
  await unscoped("behaviour test — seeds its own clinics", async () => {
    try {
      const c = await seedClinic(["sales"]);
      created.push(c.clinicId);
      const book = (source: "staff" | "whatsapp", when = day(2)) =>
        db
          .insert(appointments)
          .values({ clinicId: c.clinicId, patientId: c.patientId, doctorId: c.doctorId, scheduledAt: when, status: "scheduled", source })
          .returning({ id: appointments.id })
          .then((r) => r[0].id);
      const actor = { id: null, name: "Test" };

      console.log("\nStaff booking:");
      const a = await book("staff");
      await autoIssueInvoice(c.clinicId, a, actor);
      const invA = await getInvoiceForAppointment(c.clinicId, a);
      ok("gets an invoice number at booking", Boolean(invA) && !invA!.voided, JSON.stringify(invA));
      // One running series per clinic, never reset (migration 0121).
      ok("a new clinic's first invoice is INV-100001", invA?.label === "INV-100001", invA?.label);
      await autoIssueInvoice(c.clinicId, a, actor);
      const count = async (id: string) =>
        (await db.select({ n: sql<number>`count(*)::int` }).from(invoices).where(and(eq(invoices.clinicId, c.clinicId), eq(invoices.appointmentId, id))))[0].n;
      ok("issuing again does not take a second number", (await count(a)) === 1);

      console.log("\nCancel and bring back:");
      await applyAppointmentStatus(c.clinicId, a, "cancelled");
      const voided = await getInvoiceForAppointment(c.clinicId, a);
      ok("cancelling makes the invoice VOID", voided?.voided === true);
      ok("…and keeps its number", voided?.invoiceNo === invA?.invoiceNo);
      await applyAppointmentStatus(c.clinicId, a, "scheduled");
      const back = await getInvoiceForAppointment(c.clinicId, a);
      ok("bringing it back restores the SAME number, not void", back?.voided === false && back.invoiceNo === invA?.invoiceNo);
      await applyAppointmentStatus(c.clinicId, a, "no_show");
      ok("a no-show voids it too", (await getInvoiceForAppointment(c.clinicId, a))?.voided === true);

      console.log("\nWhatsApp request:");
      const w = await book("whatsapp", day(3));
      ok("the request itself gets no number", (await getInvoiceForAppointment(c.clinicId, w)) === null);
      await applyAppointmentStatus(c.clinicId, w, "confirmed");
      const invW = await getInvoiceForAppointment(c.clinicId, w);
      ok("confirming it gives it a number", Boolean(invW) && !invW!.voided);
      ok("…the next number in the sequence", invW?.invoiceNo === (invA?.invoiceNo ?? 0) + 1, `${invA?.invoiceNo} → ${invW?.invoiceNo}`);

      console.log("\nDoctor leave:");
      const l = await book("staff", day(5));
      await autoIssueInvoice(c.clinicId, l, actor);
      await addDoctorLeave(c.clinicId, c.doctorId, { startDate: ymd(day(5)), endDate: ymd(day(5)), reason: null });
      ok("leave cancels the visit and voids its invoice", (await getInvoiceForAppointment(c.clinicId, l))?.voided === true);

      console.log("\nTaking a payment:");
      const payActor = { id: c.doctorId, name: "Test" };
      const p1 = await book("staff", day(6));
      ok("a visit booked without a number has none", (await getInvoiceForAppointment(c.clinicId, p1)) === null);
      await recordPayment(c.clinicId, { patientId: c.patientId, appointmentId: p1, amount: 500, method: "cash", reference: null, note: null, actor: payActor });
      const invP = await getInvoiceForAppointment(c.clinicId, p1);
      ok("a payment gives it its invoice number", Boolean(invP) && !invP!.voided);
      const p2 = await book("staff", day(7));
      await applyAppointmentStatus(c.clinicId, p2, "cancelled");
      await recordPayment(c.clinicId, { patientId: c.patientId, appointmentId: p2, amount: 300, method: "cash", reference: null, note: null, actor: payActor });
      ok("a late payment on a cancelled visit gets a VOID invoice", (await getInvoiceForAppointment(c.clinicId, p2))?.voided === true);

      console.log("\nA clinic without billing:");
      const n = await seedClinic([]);
      created.push(n.clinicId);
      const [na] = await db
        .insert(appointments)
        .values({ clinicId: n.clinicId, patientId: n.patientId, doctorId: n.doctorId, scheduledAt: day(2), status: "scheduled" })
        .returning({ id: appointments.id });
      await autoIssueInvoice(n.clinicId, na.id, actor);
      ok("gets no invoice number", (await getInvoiceForAppointment(n.clinicId, na.id)) === null);
    } finally {
      for (const id of created) {
        for (const t of ["notifications", "activity_logs", "whatsapp_messages", "patient_payments", "invoices", "sales", "sale_shares", "discount_settlements", "doctor_leaves"]) {
          await db.execute(sql`delete from ${sql.identifier(t)} where clinic_id = ${id}::uuid`);
        }
        await db.delete(appointments).where(eq(appointments.clinicId, id));
        await db.delete(patients).where(eq(patients.clinicId, id));
        await db.delete(users).where(eq(users.clinicId, id));
        await db.delete(clinics).where(eq(clinics.id, id));
      }
    }
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
