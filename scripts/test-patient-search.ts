/**
 * Finding a patient from a money screen, and paging what you find.
 *
 * WHAT THIS EXISTS TO PROVE, worst first:
 *
 * 1. **Receivables search does not throw.** It did, on main. The search term was put
 *    into a condition set reused by the per-visit query, which joins `users` but not
 *    `patients` — so Postgres raised "missing FROM-clause entry for table patients"
 *    for any term that matched somebody. The failing query only runs once the page
 *    HAS patients, so an empty search looked fine and a working one 500'd.
 * 2. **One search behaves the same on all three screens.** Receivables, the payments
 *    ledger and the invoice register each had their own predicate and had already
 *    drifted (invoices matched the clinic's imported patient ref, payments did not).
 * 3. **A paged list's summary describes the WHOLE set, not the page.** The invoice
 *    register's count and total were folded from the rows, which was correct only
 *    while it was unbounded; paging it without moving them would turn "145 invoices ·
 *    Rs 2.7m" into the page's own figures (ADR-024).
 *
 * Seeds its own clinic and removes everything afterwards.
 */
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import {
  appointments,
  clinics,
  invoices,
  patientPayments,
  patients,
  users,
} from "@/core/db/schema";
import { getReceivablesReport } from "@/core/finance/receivables";
import { getPaymentsLedger } from "@/core/finance/payments-ledger";
import { getInvoicesList } from "@/core/billing/invoice";
import { formatMrn } from "@/core/patients/mrn";

let passed = 0;
let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (ok) passed++;
  else failed++;
}

async function main() {
  const [clinic] = await db
    .insert(clinics)
    .values({ name: `Search Test ${Date.now()}`, modulesEnabled: ["dental"], mrnPrefix: "ST-" })
    .returning({ id: clinics.id, mrnPrefix: clinics.mrnPrefix });
  const clinicId = clinic.id;

  try {
    const [doctor] = await db
      .insert(users)
      .values({
        clinicId,
        username: `search-doc-${Date.now()}`,
        passwordHash: "x",
        role: "doctor",
        fullName: "Dr Search",
        consultationFee: 2000,
      })
      .returning({ id: users.id });

    const [pt] = await db
      .insert(patients)
      .values({
        clinicId,
        fullName: "Zainab Quresh",
        phone: "+923001234567",
        mrn: 42,
        externalRef: "OLD-9182",
      })
      .returning({ id: patients.id, createdAt: patients.createdAt, mrn: patients.mrn });

    const mrn = formatMrn(clinic.mrnPrefix, pt.mrn, pt.createdAt)!;
    console.log(`\nSeeded patient: ${mrn}  (old ref OLD-9182)`);

    // One completed, unpaid visit — so the patient appears in receivables — plus an
    // invoice and a payment, so all three screens have something to find.
    const [appt] = await db
      .insert(appointments)
      .values({
        clinicId,
        patientId: pt.id,
        doctorId: doctor.id,
        scheduledAt: new Date(),
        status: "completed",
        amountCollected: 0,
      })
      .returning({ id: appointments.id });
    await db.insert(invoices).values({
      clinicId,
      appointmentId: appt.id,
      patientId: pt.id,
      invoiceNo: 1,
      invoiceYear: new Date().getFullYear(),
      issuedByName: "test",
    });
    await db.insert(patientPayments).values({
      clinicId,
      patientId: pt.id,
      appointmentId: appt.id,
      amount: 500,
      kind: "payment",
      method: "cash",
      occurredAt: new Date(),
      createdByName: "test",
    });

    const hits = async (q: string) => ({
      receivables: (await getReceivablesReport(clinicId, { q }, { offset: 0, limit: 20 })).patients.length,
      payments: (await getPaymentsLedger(clinicId, { q, limit: 20 })).total,
      invoices: (await getInvoicesList(clinicId, { q, limit: 20 })).count,
    });

    // THE REGRESSION. On main this threw rather than returning a number.
    console.log("\nSearching by name — the query that used to 500:");
    check("all three find the patient by name", await hits("Zainab"), {
      receivables: 1,
      payments: 1,
      invoices: 1,
    });

    console.log("\nEvery identifier works on every screen:");
    check("by phone", await hits("923001234567"), { receivables: 1, payments: 1, invoices: 1 });
    check("by FULL MRN", await hits(mrn), { receivables: 1, payments: 1, invoices: 1 });
    // The drift that existed: invoices matched the clinic's own imported ref and the
    // other two did not, so the desk could find a patient on one screen only.
    check("by the clinic's old patient number", await hits("OLD-9182"), {
      receivables: 1,
      payments: 1,
      invoices: 1,
    });
    check("a term matching nobody finds nobody", await hits("zzz-no-such-patient"), {
      receivables: 0,
      payments: 0,
      invoices: 0,
    });

    console.log("\nA paged list's summary describes the whole set, not the page:");
    // An invoice needs its OWN appointment — `invoices_appointment_unique` enforces
    // one live invoice per visit, which is the rule and not an obstacle to route
    // around. So four more visits, each invoiced.
    for (let i = 0; i < 4; i++) {
      const [extra] = await db
        .insert(appointments)
        .values({
          clinicId,
          patientId: pt.id,
          doctorId: doctor.id,
          scheduledAt: new Date(),
          status: "completed",
          amountCollected: 0,
        })
        .returning({ id: appointments.id });
      await db.insert(invoices).values({
        clinicId,
        appointmentId: extra.id,
        patientId: pt.id,
        invoiceNo: 100 + i,
        invoiceYear: new Date().getFullYear(),
        issuedByName: "test",
      });
    }
    const page1 = await getInvoicesList(clinicId, { limit: 2, offset: 0 });
    const page2 = await getInvoicesList(clinicId, { limit: 2, offset: 2 });
    check("the page is bounded", page1.rows.length, 2);
    check("…and so is the next one", page2.rows.length, 2);
    check("the COUNT is the whole set on page 1", page1.count, 5);
    check("…and identical on page 2", page2.count, page1.count);
    // The figure a reader compares against the filter. If paging changed it, the
    // header would contradict itself the moment somebody clicked Next.
    check("the TOTAL BILLED does not move between pages", page2.totalBilled, page1.totalBilled);
    check("…and it is not merely the page's sum", page1.totalBilled > page1.rows.reduce((s, r) => s + r.amount, 0), true);
  } finally {
    await db.delete(patientPayments).where(eq(patientPayments.clinicId, clinicId));
    await db.delete(invoices).where(eq(invoices.clinicId, clinicId));
    await db.delete(appointments).where(eq(appointments.clinicId, clinicId));
    await db.delete(patients).where(eq(patients.clinicId, clinicId));
    await db.delete(users).where(eq(users.clinicId, clinicId));
    await db.delete(clinics).where(eq(clinics.id, clinicId));
    console.log("\nseeded rows removed");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
