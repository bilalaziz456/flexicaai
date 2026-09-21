/**
 * Petty cash — the drawer formula, against real rows.
 *
 * WHAT THIS HAS TO PROVE, in order of what would hurt most if wrong:
 *
 * 1. The expected figure counts CASH and nothing else. A bank transfer, a cheque, and
 *    an `advance_applied` (stored credit, no notes moving) must not reach the drawer.
 * 2. The float carries forward from the COUNTED total, not the expected one — so a
 *    shortfall is absorbed at the handover instead of poisoning every later figure.
 *    This is the single design decision the feature rests on.
 * 3. A count SNAPSHOTS its variance: back-dating a cash expense into a counted window
 *    must not rewrite a number somebody already signed off.
 * 4. The first count is the opening float — expected and variance are NULL, not 0.
 *
 * It seeds its own clinic and deletes everything at the end, so it can run against a
 * database with real data in it without touching any of it.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { cashCounts, cashTransfers, clinics, expenses, patientPayments, patients } from "@/core/db/schema";
import { ALL_PERMISSIONS, ROLE_DEFAULTS } from "@/core/auth/permissions";
import type { UserRole } from "@/core/types/auth";
import {
  getDrawerState,
  recordCashCount,
  recordCashTransfer,
} from "@/core/finance/petty-cash";

let passed = 0;
let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (ok) passed++;
  else failed++;
}

const BY = { id: "00000000-0000-0000-0000-000000000001", name: "Test Counter" };

/** Local YYYY-MM-DD, matching what the app writes — `toISOString()` gives the UTC
 *  date, which is the PREVIOUS day here in PKT for most of the evening. */
function localDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The ACL defaults, pinned. A new resource is a silent revocation (ADR-033), so the
 * thing worth asserting is not that the slugs exist but WHO ends up holding them —
 * that is the part a later "tidy-up" changes without noticing.
 */
function checkAcl() {
  console.log("\nWho may count the drawer:");
  const holds = (role: UserRole, action: string) =>
    ROLE_DEFAULTS[role].includes(`cash:${action}`);
  check("the front desk counts it", holds("receptionist", "create"), true);
  check("so does a manager", holds("manager", "create"), true);
  check("and a clinic admin", holds("clinic_admin", "create"), true);
  check("a doctor does not", holds("doctor", "create"), false);
  check("…and cannot even read it", holds("doctor", "view"), false);
  // A count is an assertion about a moment; the way to correct one is another count.
  check("nobody can delete a count", ALL_PERMISSIONS.includes("cash:delete"), false);
}

async function main() {
  checkAcl();

  const [clinic] = await db
    .insert(clinics)
    .values({ name: `PettyCash Test ${Date.now()}`, modulesEnabled: ["dental"] })
    .returning({ id: clinics.id });
  const clinicId = clinic.id;

  const [patient] = await db
    .insert(patients)
    .values({ clinicId, fullName: "Cash Tester", phone: "+923009990111" })
    .returning({ id: patients.id });

  const pay = (amount: number, method: "cash" | "bank" | "cheque" | "advance", kind: "payment" | "refund" | "advance_applied") =>
    db.insert(patientPayments).values({
      clinicId,
      patientId: patient.id,
      amount,
      kind,
      method,
      occurredAt: new Date(),
      createdByName: "test",
    });

  const spend = (amount: number, method: "cash" | "bank" | null) =>
    db.insert(expenses).values({
      clinicId,
      amount,
      incurredOn: localDate(),
      method: method ?? undefined,
      createdByName: "test",
    });

  try {
    console.log("\nAn un-counted drawer knows it does not know:");
    let s = await getDrawerState(clinicId);
    check("expected is null, not 0", s.expected, null);
    check("opening is 0", s.openingTotal, 0);

    console.log("\nThe first count IS the opening float:");
    const first = await recordCashCount(clinicId, { countedTotal: 5000, by: BY });
    check("no variance to report", first.variance, null);
    s = await getDrawerState(clinicId);
    check("the drawer now opens from it", s.openingTotal, 5000);
    check("and expects exactly that", s.expected, 5000);

    console.log("\nOnly CASH reaches the drawer:");
    await pay(3000, "cash", "payment");
    await pay(9999, "bank", "payment");
    await pay(8888, "cheque", "payment");
    // Stored credit settling a bill: the system marker, no notes move.
    await pay(7777, "advance", "advance_applied");
    await spend(500, "cash");
    await spend(6666, "bank");
    s = await getDrawerState(clinicId);
    check("cash collected", s.movement.collected, 3000);
    check("cash spent", s.movement.expenses, 500);
    check("expected = 5000 + 3000 − 500", s.expected, 7500);

    console.log("\nA refund and a transfer both leave the drawer:");
    await pay(200, "cash", "refund");
    await recordCashTransfer(clinicId, { kind: "bank_deposit", amount: 4000, by: BY });
    await recordCashTransfer(clinicId, { kind: "float_topup", amount: 1000, by: BY });
    s = await getDrawerState(clinicId);
    check("refund out", s.movement.refunded, 200);
    check("banked", s.movement.transfersOut, 4000);
    check("float added", s.movement.transfersIn, 1000);
    check("expected = 7500 − 200 − 4000 + 1000", s.expected, 4300);

    console.log("\nMoney with NO tender is shown, never guessed at:");
    await spend(150, null);
    s = await getDrawerState(clinicId);
    check("it does not move the expectation", s.expected, 4300);
    check("but it is reported", s.movement.untendered.expenses, 150);

    console.log("\nA shortfall is ABSORBED at the handover, not carried forward:");
    // Someone counts 4,000 when 4,300 was expected — 300 short.
    const second = await recordCashCount(clinicId, { countedTotal: 4000, note: "300 short", by: BY });
    check("variance is signed, and negative", second.variance, -300);
    s = await getDrawerState(clinicId);
    check("the next window opens from what was COUNTED", s.openingTotal, 4000);
    check("…so the shortfall does not repeat", s.expected, 4000);

    console.log("\nA signed-off variance is a SNAPSHOT:");
    // Back-date a cash expense into the window that was already counted.
    await db.insert(expenses).values({
      clinicId,
      amount: 900,
      incurredOn: localDate(-1),
      method: "cash",
      createdByName: "late entry",
    });
    const [stored] = await db
      .select({ variance: cashCounts.variance, expected: cashCounts.expectedTotal })
      .from(cashCounts)
      .where(and(eq(cashCounts.clinicId, clinicId), eq(cashCounts.countedTotal, 4000)));
    check("the recorded variance is unchanged", stored.variance, -300);
    check("and so is the expectation it was measured against", stored.expected, 4300);
  } finally {
    await db.delete(cashTransfers).where(eq(cashTransfers.clinicId, clinicId));
    await db.delete(cashCounts).where(eq(cashCounts.clinicId, clinicId));
    await db.delete(expenses).where(eq(expenses.clinicId, clinicId));
    await db.delete(patientPayments).where(eq(patientPayments.clinicId, clinicId));
    await db.delete(patients).where(eq(patients.clinicId, clinicId));
    await db.delete(clinics).where(eq(clinics.id, clinicId));
    console.log("\nseeded rows removed");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
