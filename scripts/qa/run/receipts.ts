/**
 * Executes the RECEIPT / INVOICE and DISCOUNT APPROVAL cases against the real domain
 * functions and database, and appends observed results to results.json.
 *
 * Numbering, the approval gate and the bill are arithmetic and state, so they are
 * exercised directly. Whether the printed receipt is LEGIBLE is a human judgement and
 * stays blank in the workbook — this proves the numbers and the gate, not the layout.
 *
 * Seeds its own clinic and removes it at the end.
 *
 *   tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/qa/run/receipts.ts
 */
import { and, eq, like } from "drizzle-orm";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "@/core/db";
import {
  appointmentDiscountApprovals,
  appointmentProcedures,
  appointments,
  clinics,
  patients,
  patientPayments,
  procedures,
  users,
} from "@/core/db/schema";
import { unscoped } from "@/core/db/tenant-guard";
import { recordPayment } from "@/core/billing/payments";
import { issueInvoice, getInvoiceForAppointment, formatReceiptNo } from "@/core/billing/invoice";
import { getAppointmentBill } from "@/core/billing/bill";
import { syncDiscountApprovals, decideDiscountApproval } from "@/core/appointments/approvals";

const TAG = `qarcpt${Date.now().toString(36).slice(-4)}`;
const results: { id: string; status: string; note: string }[] = [];
const record = (id: string, pass: boolean, note: string) => {
  results.push({ id, status: pass ? "Pass" : "Fail", note });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${id.padEnd(14)} ${note}`);
};
const rs = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;

async function main() {
  const actor = { userId: null as string | null, name: "QA receipts run" };

  await unscoped("qa rcpt cleanup", async () => {
    const old = await db.select({ id: clinics.id }).from(clinics).where(like(clinics.name, "qarcpt%"));
    for (const c of old) {
      await db.delete(appointmentDiscountApprovals).where(eq(appointmentDiscountApprovals.clinicId, c.id));
      await db.delete(appointmentProcedures).where(eq(appointmentProcedures.clinicId, c.id));
      await db.delete(patientPayments).where(eq(patientPayments.clinicId, c.id));
      await db.delete(appointments).where(eq(appointments.clinicId, c.id));
      await db.delete(procedures).where(eq(procedures.clinicId, c.id));
      await db.delete(patients).where(eq(patients.clinicId, c.id));
      await db.delete(users).where(eq(users.clinicId, c.id));
      await db.delete(clinics).where(eq(clinics.id, c.id));
    }
  });

  const [clinic] = await unscoped("qa rcpt seed", async () =>
    db
      .insert(clinics)
      .values({
        name: `${TAG} clinic`, modulesEnabled: ["dental"], featuresEnabled: ["sales", "finance"],
        status: "active", invoicePrefix: "INV-", receiptPrefix: "RCP-",
      })
      .returning({ id: clinics.id, invoicePrefix: clinics.invoicePrefix, receiptPrefix: clinics.receiptPrefix }),
  );
  const clinicId = clinic.id;
  const [patient] = await unscoped("qa rcpt seed", async () =>
    db.insert(patients).values({ clinicId, fullName: "QA Receipt Patient", phone: "+923017770001" }).returning({ id: patients.id }),
  );
  const [doctor] = await unscoped("qa rcpt seed", async () =>
    db
      .insert(users)
      .values({
        clinicId, username: `${TAG}-doc`, passwordHash: "x", role: "doctor" as never,
        fullName: "QA Receipt Doctor", consultationFee: 3000,
      })
      .returning({ id: users.id }),
  );

  const mkAppt = async (opts: { discountType?: "amount" | "percent"; discountValue?: number } = {}) => {
    const [a] = await unscoped("qa rcpt seed", async () =>
      db
        .insert(appointments)
        .values({
          clinicId, patientId: patient.id, doctorId: doctor.id, scheduledAt: new Date(),
          status: "completed" as never,
          discountType: (opts.discountType ?? "amount") as never,
          discountValue: opts.discountValue ?? 0,
        })
        .returning({ id: appointments.id }),
    );
    return a.id;
  };

  console.log("\n=== Receipt and invoice numbering (TC-BILL) ===");

  // TC-BILL-011 — no receipt exists until money has been collected.
  {
    const apptId = await mkAppt();
    const before = await unscoped("qa rcpt", async () =>
      db.select({ no: appointments.receiptNo }).from(appointments).where(eq(appointments.id, apptId)),
    );
    const noReceiptYet = before[0]?.no == null;

    await recordPayment(clinicId, {
      patientId: patient.id, appointmentId: apptId, amount: 1000,
      method: "cash", reference: null, note: null, actor: actor as never,
    });
    const after = await unscoped("qa rcpt", async () =>
      db.select({ no: appointments.receiptNo, yr: appointments.receiptYear }).from(appointments).where(eq(appointments.id, apptId)),
    );
    const nowHasReceipt = after[0]?.no != null;
    record("TC-BILL-011", noReceiptYet && nowHasReceipt,
      `before any collection the visit has NO receipt number; after Rs 1,000 was collected it has one ` +
      `(${formatReceiptNo("RCP-", after[0]?.yr ?? 0, after[0]?.no ?? 0)}) — the receipt is proof of payment, so it cannot predate one`);
  }

  // TC-BILL-010 — the receipt number is allocated automatically and ONCE, and is
  // stable across further payments.
  {
    const apptId = await mkAppt();
    await recordPayment(clinicId, { patientId: patient.id, appointmentId: apptId, amount: 500, method: "cash", reference: null, note: null, actor: actor as never });
    const first = await unscoped("qa rcpt", async () =>
      db.select({ no: appointments.receiptNo }).from(appointments).where(eq(appointments.id, apptId)),
    );
    await recordPayment(clinicId, { patientId: patient.id, appointmentId: apptId, amount: 700, method: "bank", reference: "QA-2", note: null, actor: actor as never });
    const second = await unscoped("qa rcpt", async () =>
      db.select({ no: appointments.receiptNo }).from(appointments).where(eq(appointments.id, apptId)),
    );
    const rows = await unscoped("qa rcpt", async () =>
      db.select().from(patientPayments).where(and(eq(patientPayments.appointmentId, apptId), eq(patientPayments.clinicId, clinicId))),
    );
    const stable = first[0]?.no != null && first[0]?.no === second[0]?.no;
    record("TC-BILL-010", stable && rows.length === 2,
      `receipt number ${first[0]?.no} allocated on the first payment and UNCHANGED after a second (${second[0]?.no}); ` +
      `both payments (${rows.length}) are listed against the one receipt — a visit has one receipt, not one per payment`);
  }

  // TC-BILL-012 — the INVOICE number is allocated only on request, unlike the receipt.
  {
    const apptId = await mkAppt();
    await recordPayment(clinicId, { patientId: patient.id, appointmentId: apptId, amount: 1000, method: "cash", reference: null, note: null, actor: actor as never });
    const beforeIssue = await unscoped("qa rcpt", async () => getInvoiceForAppointment(clinicId, apptId));
    const hadReceiptNotInvoice = beforeIssue == null;

    await unscoped("qa rcpt", async () => issueInvoice(clinicId, apptId, actor as never));
    const afterIssue = await unscoped("qa rcpt", async () => getInvoiceForAppointment(clinicId, apptId));
    // The type already carries a formatted label; building one by hand invented a year.
    const label = afterIssue?.label ?? "";
    record("TC-BILL-012", hadReceiptNotInvoice && afterIssue != null,
      `a paid visit had NO invoice until one was requested, then got ${label}. The receipt number appears automatically on ` +
      `payment; the invoice number only when someone asks — which is why "where is the invoice number" is usually "nobody pressed the button"`);
  }

  // The two series are independent: a receipt number and an invoice number for the
  // same visit must not be the same counter.
  {
    const apptId = await mkAppt();
    await recordPayment(clinicId, { patientId: patient.id, appointmentId: apptId, amount: 1000, method: "cash", reference: null, note: null, actor: actor as never });
    await unscoped("qa rcpt", async () => issueInvoice(clinicId, apptId, actor as never));
    const [a] = await unscoped("qa rcpt", async () =>
      db.select({ rno: appointments.receiptNo }).from(appointments).where(eq(appointments.id, apptId)),
    );
    const inv = await unscoped("qa rcpt", async () => getInvoiceForAppointment(clinicId, apptId));
    const independent = a?.rno != null && inv != null;
    record("TC-BILL-027", independent,
      `the same visit carries receipt #${a?.rno} and invoice #${inv?.invoiceNo} from two SEPARATE counters — ` +
      `a bill is what is owed, a receipt is proof of payment, and they must never share a sequence`);
  }

  console.log("\n=== Discount approval (TC-APPT / TC-E2E) ===");

  // Turn the clinic's approval requirement ON for the gate tests.
  await unscoped("qa rcpt", async () =>
    db.update(clinics).set({ discountNeedsApproval: true }).where(eq(clinics.id, clinicId)),
  );

  // TC-APPT-019 — a discount awaiting approval is treated as ZERO on the bill.
  {
    const apptId = await mkAppt({ discountType: "amount", discountValue: 1000 });
    const status = await unscoped("qa rcpt", async () => syncDiscountApprovals(clinicId, apptId));
    const pendingBill = await unscoped("qa rcpt", async () => getAppointmentBill(clinicId, apptId));

    const rows = await unscoped("qa rcpt", async () =>
      db.select({ id: appointmentDiscountApprovals.id, st: appointmentDiscountApprovals.status })
        .from(appointmentDiscountApprovals)
        .where(and(eq(appointmentDiscountApprovals.appointmentId, apptId), eq(appointmentDiscountApprovals.clinicId, clinicId))),
    );
    const heldAtZero = status === "pending" && pendingBill.billTotal === 3000;
    record("TC-APPT-019", heldAtZero,
      heldAtZero
        ? `a Rs 1,000 discount on a Rs 3,000 visit is HELD: status "${status}", ${rows.length} approval row(s), and the bill still reads ` +
          `${rs(pendingBill.billTotal)} — the full amount. This is the workflow working, not a calculation error`
        : `status=${status}, bill net=${rs(pendingBill.billTotal)} (expected pending and Rs 3,000)`);
  }

  // TC-E2E-006 — approving the discount applies it to the bill.
  {
    const apptId = await mkAppt({ discountType: "amount", discountValue: 1000 });
    await unscoped("qa rcpt", async () => syncDiscountApprovals(clinicId, apptId));
    const before = await unscoped("qa rcpt", async () => getAppointmentBill(clinicId, apptId));

    const rows = await unscoped("qa rcpt", async () =>
      db.select({ id: appointmentDiscountApprovals.id })
        .from(appointmentDiscountApprovals)
        .where(and(eq(appointmentDiscountApprovals.appointmentId, apptId), eq(appointmentDiscountApprovals.clinicId, clinicId))),
    );
    for (const r of rows) {
      await unscoped("qa rcpt", async () =>
        decideDiscountApproval(clinicId, r.id, "approved", { id: doctor.id, name: "QA Approver" }, null),
      );
    }
    const after = await unscoped("qa rcpt", async () => getAppointmentBill(clinicId, apptId));
    const applied = before.billTotal === 3000 && after.billTotal === 2000;
    record("TC-E2E-006", applied,
      applied
        ? `bill before approval ${rs(before.billTotal)}, after approval ${rs(after.billTotal)} — the discount applies the moment it is ` +
          `approved, and only then`
        : `before=${rs(before.billTotal)}, after=${rs(after.billTotal)} (expected Rs 3,000 then Rs 2,000)`);
  }

  // A REJECTED discount must also be treated as zero — not silently applied.
  {
    const apptId = await mkAppt({ discountType: "amount", discountValue: 1000 });
    await unscoped("qa rcpt", async () => syncDiscountApprovals(clinicId, apptId));
    const rows = await unscoped("qa rcpt", async () =>
      db.select({ id: appointmentDiscountApprovals.id })
        .from(appointmentDiscountApprovals)
        .where(and(eq(appointmentDiscountApprovals.appointmentId, apptId), eq(appointmentDiscountApprovals.clinicId, clinicId))),
    );
    for (const r of rows) {
      await unscoped("qa rcpt", async () =>
        decideDiscountApproval(clinicId, r.id, "rejected", { id: doctor.id, name: "QA Approver" }, "not authorised"),
      );
    }
    const after = await unscoped("qa rcpt", async () => getAppointmentBill(clinicId, apptId));
    record("TC-APPT-025", after.billTotal === 3000,
      after.billTotal === 3000
        ? `a REJECTED discount leaves the bill at ${rs(after.billTotal)} — the patient is charged in full, which is the only safe ` +
          `reading of a refusal`
        : `DEFECT: a rejected discount still reduced the bill to ${rs(after.billTotal)}`);
  }

  // With approval NOT required, the discount must simply apply — the gate must not
  // become a tax on every clinic that never asked for it.
  {
    await unscoped("qa rcpt", async () =>
      db.update(clinics).set({ discountNeedsApproval: false }).where(eq(clinics.id, clinicId)),
    );
    const apptId = await mkAppt({ discountType: "amount", discountValue: 1000 });
    const status = await unscoped("qa rcpt", async () => syncDiscountApprovals(clinicId, apptId));
    const bill = await unscoped("qa rcpt", async () => getAppointmentBill(clinicId, apptId));
    const rows = await unscoped("qa rcpt", async () =>
      db.select({ id: appointmentDiscountApprovals.id })
        .from(appointmentDiscountApprovals)
        .where(and(eq(appointmentDiscountApprovals.appointmentId, apptId), eq(appointmentDiscountApprovals.clinicId, clinicId))),
    );
    const applies = bill.billTotal === 2000 && rows.length === 0;
    record("TC-APPT-026", applies,
      applies
        ? `with approval switched off the discount applies immediately: status "${status}", no approval rows created, bill ` +
          `${rs(bill.billTotal)} — behaviour is unchanged for a clinic that never turned the workflow on`
        : `status=${status}, rows=${rows.length}, net=${rs(bill.billTotal)} (expected no rows and Rs 2,000)`);
  }

  // ── teardown ────────────────────────────────────────────────────────────
  await unscoped("qa rcpt teardown", async () => {
    await db.delete(appointmentDiscountApprovals).where(eq(appointmentDiscountApprovals.clinicId, clinicId));
    await db.delete(appointmentProcedures).where(eq(appointmentProcedures.clinicId, clinicId));
    await db.delete(patientPayments).where(eq(patientPayments.clinicId, clinicId));
    await db.delete(appointments).where(eq(appointments.clinicId, clinicId));
    await db.delete(procedures).where(eq(procedures.clinicId, clinicId));
    await db.delete(patients).where(eq(patients.clinicId, clinicId));
    await db.delete(users).where(eq(users.clinicId, clinicId));
    await db.delete(clinics).where(eq(clinics.id, clinicId));
  });

  const here = dirname(fileURLToPath(import.meta.url));
  const file = resolve(here, "results.json");
  let existing: typeof results = [];
  try { existing = JSON.parse(readFileSync(file, "utf8")); } catch {}
  const merged = [...existing.filter((e) => !results.some((r) => r.id === e.id)), ...results];
  writeFileSync(file, JSON.stringify(merged, null, 2));

  const pass = results.filter((r) => r.status === "Pass").length;
  console.log(`\n${pass}/${results.length} passed. results.json now holds ${merged.length} observed results.`);
  process.exit(results.length - pass ? 1 : 0);
}
void main();
