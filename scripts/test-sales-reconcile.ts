/**
 * Tests the derived-ledger safety net (D-03 / ADR-016) against a real database.
 *
 * The derived set — `sales`, `sale_shares`, `discount_settlements`, per-line waives —
 * is now written in ONE transaction, so it can never be internally half-applied. But
 * the write stays best-effort on the paths where blocking the user would be worse than
 * a delay (taking a payment, above all). That trade is only safe because the state is
 * RECOMPUTABLE and something actually recomputes it. This checks that something works:
 * corrupt the ledger the way a failed write would, and assert reconciliation puts it
 * back.
 *
 * Since 2026-10-13 revenue follows the MONEY, not the visit's status: a visit's sale
 * rows are one per day money moved, derived from its payment ledger. So the seeding
 * records a real payment (the old test set `amount_collected` with nothing behind
 * it), and "un-completing" a visit no longer removes its revenue — trashing it does.
 *
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-sales-reconcile.ts`
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import {
  appointments,
  clinics,
  patientPayments,
  patients,
  saleShares,
  sales,
  users,
} from "@/core/db/schema";
import { unscoped } from "@/core/db/tenant-guard";
import { recordSaleForAppointment } from "@/core/sales/ledger";
import { reconcileClinicSales } from "@/core/sales/reconcile";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
  }
}

const uniq = Date.now();
let clinicId = "";
let doctorId = "";
let patientId = "";
let apptId = "";

const FEE = 4000;
const COLLECTED = 4000;

async function seed() {
  clinicId = (
    await db.insert(clinics).values({ name: `reconcile ${uniq}` }).returning({ id: clinics.id })
  )[0].id;
  doctorId = (
    await db
      .insert(users)
      .values({
        clinicId,
        username: `rec_${uniq}`,
        passwordHash: "x",
        role: "doctor",
        fullName: "Reconcile Doctor",
        consultationFee: FEE,
        // A share % so the per-doctor earnings ledger is exercised too, not just `sales`.
        consultationSharePct: 50,
      })
      .returning({ id: users.id })
  )[0].id;
  patientId = (
    await db
      .insert(patients)
      .values({ clinicId, fullName: "Reconcile Patient" })
      .returning({ id: patients.id })
  )[0].id;
  apptId = (
    await db
      .insert(appointments)
      .values({
        clinicId,
        patientId,
        doctorId,
        module: "dental",
        scheduledAt: new Date(),
        status: "completed",
        amountCollected: COLLECTED,
      })
      .returning({ id: appointments.id })
  )[0].id;
  // The payment itself — the sale is derived from this, not from the cache above.
  await db.insert(patientPayments).values({
    clinicId,
    patientId,
    appointmentId: apptId,
    kind: "payment",
    amount: COLLECTED,
    method: "cash",
  });
}

const saleTotal = async () => {
  const rows = await db.select().from(sales).where(eq(sales.appointmentId, apptId));
  return rows.length === 0 ? null : rows.reduce((n, r) => n + r.netAmount, 0);
};
const shareRows = async () =>
  await db.select().from(saleShares).where(eq(saleShares.appointmentId, apptId));

async function main() {
  await seed();

  console.log("The derived set is written together:");
  {
    await recordSaleForAppointment(clinicId, apptId);
    check("a sale is recorded for the paid visit", await saleTotal(), COLLECTED);
    // The point of the transaction: revenue and the doctor credited for it either both
    // exist or neither does. Previously these were separate writes on separate
    // connections and a crash between them left revenue with nobody credited.
    check("…and the doctor's share row exists alongside it", (await shareRows()).length, 1);
    check("…crediting half the fee", (await shareRows())[0]?.shareAmount, FEE / 2);
  }

  console.log("\nA MISSING sale (what a failed write leaves) is re-derived:");
  {
    await unscoped("test: simulate a lost sale", () =>
      db.delete(sales).where(eq(sales.appointmentId, apptId)),
    );
    check("…gone", await saleTotal(), null);

    const r = await reconcileClinicSales(clinicId);
    check("reconcile reports one repair", { repaired: r.repaired, voided: r.voided, failed: r.failed }, { repaired: 1, voided: 0, failed: 0 });
    check("…and the sale is back, with the right amount", await saleTotal(), COLLECTED);
  }

  console.log("\nA WRONG amount (a stale snapshot) is corrected:");
  {
    await unscoped("test: simulate a drifted sale", () =>
      db.update(sales).set({ netAmount: 1 }).where(eq(sales.appointmentId, apptId)),
    );
    const r = await reconcileClinicSales(clinicId);
    check("reconcile repairs it", r.repaired, 1);
    check("…back to the collected amount", await saleTotal(), COLLECTED);
  }

  console.log("\nThe status no longer decides revenue — the money does:");
  {
    // Move it back to Scheduled behind the app's back. Under the old rule reconcile
    // voided the revenue; now the money was received, so it stays.
    await db
      .update(appointments)
      .set({ status: "scheduled" })
      // Clinic-scoped even in scaffolding: the tenant guard flags an id-only write,
      // and a guard that routinely warns is a guard people stop reading.
      .where(and(eq(appointments.clinicId, clinicId), eq(appointments.id, apptId)));
    const r = await reconcileClinicSales(clinicId);
    check("reconcile finds nothing to change", r, { repaired: 0, voided: 0, failed: 0 });
    check("…the revenue is still there", await saleTotal(), COLLECTED);
    check("…and the doctor is still credited", (await shareRows()).length, 1);
  }

  console.log("\nRevenue left on the books for a TRASHED visit is removed:");
  {
    await db
      .update(appointments)
      .set({ deletedAt: new Date() })
      .where(and(eq(appointments.clinicId, clinicId), eq(appointments.id, apptId)));
    const r = await reconcileClinicSales(clinicId);
    check("reconcile voids it", { voided: r.voided, failed: r.failed }, { voided: 1, failed: 0 });
    check("…no sale remains", await saleTotal(), null);
    check("…and no doctor is still credited", (await shareRows()).length, 0);
  }

  console.log("\nIt is idempotent — a clean clinic reports no drift:");
  {
    const r = await reconcileClinicSales(clinicId);
    check("second run changes nothing", r, { repaired: 0, voided: 0, failed: 0 });
  }

  await unscoped("test cleanup", async () => {
    await db.execute(sql`delete from discount_settlements where clinic_id = ${clinicId}::uuid`);
    await db.delete(patientPayments).where(eq(patientPayments.clinicId, clinicId));
    await db.delete(saleShares).where(eq(saleShares.clinicId, clinicId));
    await db.delete(sales).where(eq(sales.clinicId, clinicId));
    await db.delete(appointments).where(eq(appointments.clinicId, clinicId));
    await db.delete(patients).where(eq(patients.clinicId, clinicId));
    await db.delete(users).where(eq(users.clinicId, clinicId));
    await db.delete(clinics).where(eq(clinics.id, clinicId));
  });
  console.log("\nseeded rows removed");
}

main()
  .catch((e) => {
    failures++;
    console.error(e);
  })
  .finally(() => {
    console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
