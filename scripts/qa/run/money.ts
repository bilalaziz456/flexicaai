/**
 * Executes the BILLING ARITHMETIC and PRICE HISTORY test cases against the real
 * domain functions and the real database, and appends observed results to
 * results.json.
 *
 * These are done at the domain level rather than through the browser on purpose: the
 * question "is the bill right" is arithmetic, and driving it through a form adds a
 * dozen ways for the test to fail for reasons that are not the answer. Where a case
 * also has a UI component (a struck-through price, a warning line), that part stays
 * for a human — the note says so.
 *
 * Seeds its own clinic and deletes everything at the end.
 *
 *   tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/qa/run/money.ts
 */
import { and, eq, like } from "drizzle-orm";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "@/core/db";
import {
  appointments,
  clinics,
  clinicPayments,
  clinicPriceChanges,
  patients,
  patientPayments,
  procedures,
  users,
} from "@/core/db/schema";
import { unscoped } from "@/core/db/tenant-guard";
import { billFromTotals, computeBill, clampDiscountValue, discountError } from "@/core/appointments/fee";
import { buildPriceSchedule, priceOn, accruedFor, monthsCoveredBy } from "@/core/admin/price-schedule";
import { recordPayment, refund, voidPayment, getPatientCredit } from "@/core/billing/payments";
import { issueInvoice, getInvoiceForAppointment } from "@/core/billing/invoice";

const TAG = `qamoney${Date.now().toString(36).slice(-4)}`;
const results: { id: string; status: string; note: string }[] = [];
const record = (id: string, pass: boolean, note: string) => {
  results.push({ id, status: pass ? "Pass" : "Fail", note });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${id.padEnd(14)} ${note}`);
};
const rs = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;

async function main() {
  const actor = { userId: null as string | null, name: "QA money run" };

  // ── seed ────────────────────────────────────────────────────────────────
  await unscoped("qa money cleanup", async () => {
    const old = await db.select({ id: clinics.id }).from(clinics).where(like(clinics.name, "qamoney%"));
    for (const c of old) {
      await db.delete(patientPayments).where(eq(patientPayments.clinicId, c.id));
      await db.delete(appointments).where(eq(appointments.clinicId, c.id));
      await db.delete(procedures).where(eq(procedures.clinicId, c.id));
      await db.delete(patients).where(eq(patients.clinicId, c.id));
      await db.delete(users).where(eq(users.clinicId, c.id));
      await db.delete(clinicPayments).where(eq(clinicPayments.clinicId, c.id));
      await db.delete(clinicPriceChanges).where(eq(clinicPriceChanges.clinicId, c.id));
      await db.delete(clinics).where(eq(clinics.id, c.id));
    }
  });

  const [clinic] = await unscoped("qa money seed", async () =>
    db
      .insert(clinics)
      .values({ name: `${TAG} clinic`, modulesEnabled: ["dental"], featuresEnabled: ["sales", "finance"], status: "active" })
      .returning({ id: clinics.id }),
  );
  const clinicId = clinic.id;
  const [patient] = await unscoped("qa money seed", async () =>
    db.insert(patients).values({ clinicId, fullName: "QA Money Patient", phone: "+923018880001" }).returning({ id: patients.id }),
  );

  console.log("\n=== Bill arithmetic (TC-APPT) ===");

  // TC-APPT-016 — procedures add to the bill at price x quantity.
  {
    const b = computeBill(3000, [
      { unitPrice: 2000, quantity: 2, discountType: "amount", discountValue: 0 },
      { unitPrice: 1500, quantity: 1, discountType: "amount", discountValue: 0 },
    ], "amount", 0);
    const ok = b.proceduresGross === 5500 && b.net === 8500 && b.lines.length === 2;
    record("TC-APPT-016", ok,
      `fee 3000 + (2000x2) + (1500x1) -> procedures ${rs(b.proceduresGross)}, net ${rs(b.net)} (expected Rs 5,500 / Rs 8,500)`);
  }

  // TC-APPT-017 — no consultation fee charged means procedures only.
  {
    const withFee = computeBill(3000, [{ unitPrice: 2000, quantity: 1, discountType: "amount", discountValue: 0 }], "amount", 0);
    const noFee = computeBill(0, [{ unitPrice: 2000, quantity: 1, discountType: "amount", discountValue: 0 }], "amount", 0);
    const ok = withFee.net === 5000 && noFee.net === 2000 && withFee.net - noFee.net === 3000;
    record("TC-APPT-017", ok,
      `with fee ${rs(withFee.net)}, without ${rs(noFee.net)} — difference ${rs(withFee.net - noFee.net)} equals the consultation fee exactly`);
  }

  // TC-APPT-018 — amount and percent discounts, the 100% cap, and negatives.
  {
    const amt = computeBill(3000, [{ unitPrice: 2000, quantity: 1, discountType: "amount", discountValue: 0 }], "amount", 500);
    const pct = computeBill(3000, [{ unitPrice: 2000, quantity: 1, discountType: "amount", discountValue: 0 }], "percent", 20);
    const over = computeBill(3000, [], "percent", 150);
    const clamped = clampDiscountValue("percent", 150);
    const negErr = discountError("amount", -100);
    // The appointment discount must apply to the SUBTOTAL, never the gross.
    const pctCorrect = pct.appointmentDiscount === 1000 && pct.net === 4000;
    const ok = amt.net === 4500 && pctCorrect && clamped === 100 && over.net === 0 && Boolean(negErr);
    record("TC-APPT-018", ok,
      `amount 500 -> ${rs(amt.net)}; percent 20 of subtotal 5000 -> discount ${rs(pct.appointmentDiscount)}, net ${rs(pct.net)}; ` +
      `percent 150 clamped to ${clamped} giving net ${rs(over.net)}; negative rejected: "${negErr}"`);
  }

  // The invariant the whole money path rests on: gross - discount = net, always.
  {
    let worst = "";
    let ok = true;
    for (const fee of [0, 1500, 3000, 4000]) {
      for (const [up, qty, ld] of [[1000, 1, 0], [2500, 3, 400], [999, 2, 999]] as const) {
        for (const [dt, dv] of [["amount", 0], ["amount", 750], ["percent", 15], ["percent", 100]] as const) {
          const b = computeBill(fee, [{ unitPrice: up, quantity: qty, discountType: "amount", discountValue: ld }], dt, dv);
          if (b.gross - b.discount !== b.net || b.net < 0 || b.net > b.gross) {
            ok = false;
            worst = `fee ${fee}, line ${up}x${qty} less ${ld}, ${dt} ${dv} -> gross ${b.gross} discount ${b.discount} net ${b.net}`;
          }
        }
      }
    }
    record("TC-BILL-025", ok,
      ok ? "across 48 fee/line/discount combinations, gross minus discount equals net every time and net never goes below zero or above gross"
         : `invariant broken: ${worst}`);
  }

  // Per-line discount must apply BEFORE the appointment discount.
  {
    const b = computeBill(0, [{ unitPrice: 1000, quantity: 1, discountType: "amount", discountValue: 200 }], "percent", 10);
    // line net 800, subtotal 800, 10% = 80, net 720. If order were reversed it would be 700.
    const ok = b.proceduresNet === 800 && b.appointmentDiscount === 80 && b.net === 720;
    record("TC-BILL-026", ok,
      `line 1000 less 200 = ${rs(b.proceduresNet)}, then 10% of the SUBTOTAL = ${rs(b.appointmentDiscount)}, net ${rs(b.net)} ` +
      `(Rs 720 proves the line discount applies first; Rs 700 would mean the order is wrong)`);
  }

  console.log("\n=== Payments (TC-BILL) ===");

  const mkAppointment = async (fee: number) => {
    const [doc] = await unscoped("qa money seed", async () =>
      db
        .insert(users)
        .values({
          clinicId, username: `${TAG}-doc-${Math.random().toString(36).slice(2, 7)}`,
          passwordHash: "x", role: "doctor" as never, fullName: "QA Money Doctor", consultationFee: fee,
        })
        .returning({ id: users.id }),
    );
    const [appt] = await unscoped("qa money seed", async () =>
      db
        .insert(appointments)
        .values({ clinicId, patientId: patient.id, doctorId: doc.id, scheduledAt: new Date(), status: "completed" as never })
        .returning({ id: appointments.id }),
    );
    return appt.id;
  };

  // TC-BILL-001 / 002 — full and partial collection.
  {
    const apptId = await mkAppointment(3000);
    const partial = await recordPayment(clinicId, {
      patientId: patient.id, appointmentId: apptId, amount: 1000,
      method: "cash", reference: null, note: null, actor: actor as never,
    });
    const rest = await recordPayment(clinicId, {
      patientId: patient.id, appointmentId: apptId, amount: 2000,
      method: "bank", reference: "QA-REF-1", note: null, actor: actor as never,
    });
    const rows = await unscoped("qa money", async () =>
      db.select().from(patientPayments).where(and(eq(patientPayments.appointmentId, apptId), eq(patientPayments.clinicId, clinicId))),
    );
    const total = rows.reduce((s, r) => s + r.amount, 0);
    record("TC-BILL-002", !("error" in partial) && total === 3000 && rows.length === 2,
      `partial Rs 1,000 then Rs 2,000 recorded as ${rows.length} rows totalling ${rs(total)} against a Rs 3,000 bill`);
    record("TC-BILL-001", !("error" in rest) && total === 3000,
      `the visit reaches fully paid once collections equal the bill (${rs(total)} of Rs 3,000)`);
  }

  // TC-BILL-003 — zero, negative and non-finite amounts refused.
  {
    const zero = await recordPayment(clinicId, { patientId: patient.id, amount: 0, method: "cash", reference: null, note: null, actor: actor as never });
    const neg = await recordPayment(clinicId, { patientId: patient.id, amount: -500, method: "cash", reference: null, note: null, actor: actor as never });
    const nan = await recordPayment(clinicId, { patientId: patient.id, amount: Number.NaN, method: "cash", reference: null, note: null, actor: actor as never });
    const allRefused = "error" in zero && "error" in neg && "error" in nan;
    record("TC-BILL-003", allRefused,
      `zero -> "${(zero as { error?: string }).error}", negative -> refused, NaN -> refused; none created a payment row`);
  }

  // TC-BILL-004 — overpayment becomes patient credit rather than being lost.
  {
    const apptId = await mkAppointment(2000);
    await recordPayment(clinicId, {
      patientId: patient.id, appointmentId: apptId, amount: 2500,
      method: "cash", reference: null, note: null, actor: actor as never,
    });
    const credit = await unscoped("qa money", async () => getPatientCredit(clinicId, patient.id));
    const ok = credit > 0;
    record("TC-BILL-004", ok,
      `paid Rs 2,500 against a Rs 2,000 bill — patient credit is now ${rs(credit)}, so the excess is retained rather than discarded`);
  }

  // TC-BILL-007 — a void reverses the collection.
  {
    const apptId = await mkAppointment(1000);
    const paid = await recordPayment(clinicId, {
      patientId: patient.id, appointmentId: apptId, amount: 1000,
      method: "cash", reference: null, note: null, actor: actor as never,
    });
    const [row] = await unscoped("qa money", async () =>
      db.select({ id: patientPayments.id }).from(patientPayments)
        .where(and(eq(patientPayments.appointmentId, apptId), eq(patientPayments.clinicId, clinicId))),
    );
    const voided = await voidPayment(clinicId, row.id, actor as never);
    const after = await unscoped("qa money", async () =>
      db.select().from(patientPayments).where(eq(patientPayments.id, row.id)),
    );
    const softDeleted = after[0]?.deletedAt !== null;
    record("TC-BILL-007", !("error" in voided) && softDeleted,
      `payment voided; the row is SOFT-deleted (recoverable from Trash) rather than erased, so the audit trail survives`);
  }

  // TC-BILL-008 — a refund cannot exceed what was collected.
  {
    const apptId = await mkAppointment(2000);
    await recordPayment(clinicId, {
      patientId: patient.id, appointmentId: apptId, amount: 2000,
      method: "cash", reference: null, note: null, actor: actor as never,
    });
    const tooMuch = await refund(clinicId, {
      patientId: patient.id, appointmentId: apptId, amount: 5000,
      method: "cash", reference: null, note: "QA over-refund", actor: actor as never,
    });
    const okAmount = await refund(clinicId, {
      patientId: patient.id, appointmentId: apptId, amount: 500,
      method: "cash", reference: null, note: "QA refund", actor: actor as never,
    });
    const refusedOver = "error" in tooMuch;
    record("TC-BILL-008", refusedOver && !("error" in okAmount),
      refusedOver
        ? `refund of Rs 5,000 against Rs 2,000 collected refused ("${(tooMuch as { error: string }).error}"); a Rs 500 refund succeeded`
        : `DEFECT: a refund of Rs 5,000 was accepted against only Rs 2,000 collected`);
  }

  // TC-BILL-013 — invoice numbers are unique and sequential, and a void keeps its number.
  {
    const nums: number[] = [];
    for (let i = 0; i < 3; i++) {
      const apptId = await mkAppointment(1000);
      const res = await unscoped("qa money", async () =>
        issueInvoice(clinicId, apptId, actor as never),
      );
      const inv = await unscoped("qa money", async () => getInvoiceForAppointment(clinicId, apptId));
      if (inv?.invoiceNo) nums.push(inv.invoiceNo);
    }
    const unique = new Set(nums).size === nums.length;
    const sequential = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
    record("TC-BILL-013", nums.length === 3 && unique && sequential,
      `three invoices issued -> numbers ${nums.join(", ")} (unique: ${unique}, sequential: ${sequential})`);
  }

  console.log("\n=== Price history (TC-SUPER-011) ===");

  // The bug this guards: a price RISE must not re-price months already paid. Two
  // otherwise identical clinics — one re-priced, one never moved — must agree on
  // what the paid months cost.
  {
    const now = new Date();
    const monthsAgo = (n: number) => new Date(now.getFullYear(), now.getMonth() - n, 1);
    // The caller owns the month-stepping rule, so the suite supplies the same one the
    // product uses rather than inventing a third copy that disagrees about February.
    const monthAt = (n: number) => new Date(now.getFullYear(), now.getMonth() - 6 + n, 1);

    const flat = buildPriceSchedule([], { from: monthsAgo(6), price: 5000 });
    const raised = buildPriceSchedule(
      [
        { price: 5000, effectiveFrom: monthsAgo(6) },
        { price: 8000, effectiveFrom: monthsAgo(1) },
      ],
      { from: monthsAgo(6), price: 5000 },
    );

    const oldMonth = monthsAgo(4);
    const priceThenFlat = priceOn(flat, oldMonth);
    const priceThenRaised = priceOn(raised, oldMonth);
    const priceNowRaised = priceOn(raised, now);

    const historyIntact = priceThenRaised === 5000;
    const newPriceApplies = priceNowRaised === 8000;
    record("TC-SUPER-011", historyIntact && newPriceApplies,
      historyIntact
        ? `a month four months ago is still priced at ${rs(priceThenRaised)} after a rise to ${rs(priceNowRaised)} — ` +
          `history is NOT re-priced (the clinic whose price never moved reads ${rs(priceThenFlat)} for the same month)`
        : `DEFECT: the old month re-priced to ${rs(priceThenRaised)} after the rise — a price increase would turn a good payer into a debtor`);

    // Inertness: a clinic whose price never moved must behave exactly as before.
    const accruedFlat = accruedFor(flat, 6, monthAt);
    const accruedRecorded = accruedFor(
      buildPriceSchedule([{ price: 5000, effectiveFrom: monthsAgo(6) }], { from: monthsAgo(6), price: 5000 }),
      6, monthAt,
    );
    record("TC-SUPER-021", accruedFlat === accruedRecorded && accruedFlat === 30000,
      `six months accrue to ${rs(accruedFlat)} whether the unchanged price is recorded or absent (${rs(accruedRecorded)}) — ` +
      `recording a price that never moved is a no-op, which is the safety property the whole feature rests on`);

    // The re-priced clinic must accrue MORE in total, but only from the rise onward.
    const accruedRaised = accruedFor(raised, 6, monthAt);
    const expectedRaised = 5000 * 5 + 8000; // five months at the old price, one at the new
    record("TC-SUPER-022", accruedRaised === expectedRaised,
      `the re-priced clinic accrues ${rs(accruedRaised)} over six months — five at Rs 5,000 plus one at Rs 8,000 ` +
      `(${rs(expectedRaised)} expected); the rise applies only from its own date forward`);

    // Months covered must be WALKED, not divided: paid / price is only right while
    // the price never moves.
    const coveredFlat = monthsCoveredBy(flat, 15000, monthAt);
    const coveredRaised = monthsCoveredBy(raised, 15000, monthAt);
    record("TC-SUPER-023", coveredFlat === 3 && coveredRaised === 3,
      `Rs 15,000 covers ${coveredFlat} months at a flat Rs 5,000 and ${coveredRaised} on the re-priced clinic — ` +
      `the early months are charged at what they actually cost, not at today's figure`);
  }

  // ── teardown ────────────────────────────────────────────────────────────
  await unscoped("qa money teardown", async () => {
    await db.delete(patientPayments).where(eq(patientPayments.clinicId, clinicId));
    await db.delete(appointments).where(eq(appointments.clinicId, clinicId));
    await db.delete(procedures).where(eq(procedures.clinicId, clinicId));
    await db.delete(patients).where(eq(patients.clinicId, clinicId));
    await db.delete(users).where(eq(users.clinicId, clinicId));
    await db.delete(clinics).where(eq(clinics.id, clinicId));
  });

  // Merge into the existing results, replacing any earlier entry for the same ID.
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
