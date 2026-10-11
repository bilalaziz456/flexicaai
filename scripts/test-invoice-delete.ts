/**
 * DELETING AN INVOICE (owner's call, 2026-10-12): refused while money is held; once
 * refunded it voids the invoice with who/why (number kept), cancels the visit, and
 * the deletion sticks — bringing the visit back does NOT restore a deleted invoice,
 * while it still restores one voided only by a cancellation. The register's Status
 * filter separates the two. Seeds its own clinic and removes it. Run:
 * `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-invoice-delete.ts`
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { appointments, clinics, patients, users } from "@/core/db/schema";
import { getInvoiceForAppointment, getInvoicesList, issueInvoice } from "@/core/billing/invoice";
import { deleteInvoice } from "@/core/billing/invoice-delete";
import { recordPayment, refund } from "@/core/billing/payments";
import { applyAppointmentStatus } from "@/core/appointments/set-status";

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
    const tag = `idel${Date.now()}`;
    const [clinic] = await db
      .insert(clinics)
      .values({ name: tag, modulesEnabled: ["dental"], featuresEnabled: ["sales"] })
      .returning({ id: clinics.id });
    const clinicId = clinic.id;
    try {
      const [doctor] = await db
        .insert(users)
        .values({ clinicId, username: `${tag}doc`, passwordHash: "x", role: "doctor", fullName: "Del Doc", flexibleHours: true, consultationFee: 1000 })
        .returning({ id: users.id });
      const [patient] = await db
        .insert(patients)
        .values({ clinicId, fullName: "Del Patient", phone: "+923001230003" })
        .returning({ id: patients.id });
      const actor = { id: doctor.id, name: "Ayesha (front desk)" };
      let day = 1;
      const visit = async () => {
        const when = new Date();
        when.setDate(when.getDate() - day++);
        when.setHours(10, 0, 0, 0);
        const [a] = await db
          .insert(appointments)
          .values({ clinicId, patientId: patient.id, doctorId: doctor.id, scheduledAt: when, status: "scheduled" })
          .returning({ id: appointments.id });
        await issueInvoice(clinicId, a.id, actor);
        await applyAppointmentStatus(clinicId, a.id, "completed", { notify: false });
        return a.id;
      };
      const statusOf = async (id: string) =>
        (await db.select({ s: appointments.status }).from(appointments).where(eq(appointments.id, id)))[0].s;

      console.log("\nMoney held:");
      const a = await visit();
      await recordPayment(clinicId, { patientId: patient.id, appointmentId: a, amount: 600, method: "cash", reference: null, note: null, actor });
      const refused = await deleteInvoice(clinicId, a, actor, "entered twice");
      ok("delete is refused while Rs 600 is held", "error" in refused && /Refund it first/.test(refused.error), JSON.stringify(refused));
      ok("…and nothing changed", (await getInvoiceForAppointment(clinicId, a))?.voided === false && (await statusOf(a)) === "completed");

      console.log("\nRefund, then delete:");
      await refund(clinicId, { patientId: patient.id, appointmentId: a, amount: 600, method: "cash", reference: null, note: null, actor });
      const done = await deleteInvoice(clinicId, a, actor, "entered twice");
      ok("delete succeeds once refunded", "ok" in done, JSON.stringify(done));
      const inv = await getInvoiceForAppointment(clinicId, a);
      ok("the invoice is kept, voided, with its number", Boolean(inv) && inv!.voided);
      ok("…marked deleted by who, with the reason", inv?.deleted?.byName === actor.name && inv?.deleted?.reason === "entered twice", JSON.stringify(inv?.deleted));
      ok("its visit is cancelled", (await statusOf(a)) === "cancelled");
      const again = await deleteInvoice(clinicId, a, actor, "");
      ok("deleting it again is refused", "error" in again && /already deleted/.test(again.error));

      console.log("\nBringing the visit back:");
      await applyAppointmentStatus(clinicId, a, "scheduled", { notify: false });
      ok("a DELETED invoice stays deleted", (await getInvoiceForAppointment(clinicId, a))?.deleted != null);
      const b = await visit();
      await applyAppointmentStatus(clinicId, b, "cancelled", { notify: false });
      ok("a cancellation voids the other invoice (not deleted)", (await getInvoiceForAppointment(clinicId, b))?.voided === true && (await getInvoiceForAppointment(clinicId, b))?.deleted === null);
      await applyAppointmentStatus(clinicId, b, "scheduled", { notify: false });
      ok("…and bringing that visit back restores it", (await getInvoiceForAppointment(clinicId, b))?.voided === false);

      console.log("\nThe register's Status filter:");
      const c = await visit();
      const all = await getInvoicesList(clinicId, { limit: 1000 });
      const deleted = await getInvoicesList(clinicId, { state: "deleted", limit: 1000 });
      const active = await getInvoicesList(clinicId, { state: "active", limit: 1000 });
      ok("Deleted lists only the deleted invoice", deleted.count === 1 && deleted.rows[0].appointmentId === a && deleted.rows[0].deleted?.reason === "entered twice");
      ok("Active lists the other two", active.count === 2 && active.rows.every((r) => r.appointmentId === b || r.appointmentId === c));
      ok("All lists all three", all.count === 3);
      ok("a deleted invoice bills nothing in Total billed", all.totalBilled === 2000, String(all.totalBilled));
    } finally {
      for (const t of ["notifications", "activity_logs", "whatsapp_messages", "patient_payments", "invoices", "sales", "sale_shares", "discount_settlements"]) {
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
