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
  listDrawerHistory,
  recordCashCount,
  recordCashTransfer,
  softDeleteCashCount,
  softDeleteDrawerSpend,
  updateCashCount,
  updateDrawerSpend,
  type DrawerEntry,
} from "@/core/finance/petty-cash";
import { mayModifyEntry } from "@/app/clinic/cash/ownership";
import type { CurrentUser } from "@/core/types/auth";

let passed = 0;
let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (ok) passed++;
  else failed++;
}

const BY = { id: "00000000-0000-0000-0000-000000000001", name: "Test Counter" };

/** One id per history row, whatever kind it is — so the paging assertions below do not
 *  have to know the union's shape. */
function entryId(r: DrawerEntry): string {
  return r.kind === "count" ? r.count.id : r.kind === "move" ? r.move.id : r.spend.id;
}

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

    console.log("\nCorrecting a miscount re-derives from the FROZEN expectation:");
    const [toFix] = await db
      .select({ id: cashCounts.id })
      .from(cashCounts)
      .where(and(eq(cashCounts.clinicId, clinicId), eq(cashCounts.countedTotal, 4000)));
    // Somebody typed 4,000 and meant 4,250. The expectation at that moment was 4,300
    // and nothing since can change what was true then.
    await updateCashCount(clinicId, toFix.id, { countedTotal: 4250, note: "miscount, recounted" });
    const [fixed] = await db
      .select({
        counted: cashCounts.countedTotal,
        expected: cashCounts.expectedTotal,
        variance: cashCounts.variance,
      })
      .from(cashCounts)
      .where(and(eq(cashCounts.clinicId, clinicId), eq(cashCounts.id, toFix.id)));
    check("the counted figure is corrected", fixed.counted, 4250);
    check("the expectation is UNTOUCHED", fixed.expected, 4300);
    check("…and the variance follows from it, not from today", fixed.variance, -50);
    s = await getDrawerState(clinicId);
    check("later windows open from the corrected figure", s.openingTotal, 4250);

    console.log("\nOnly your own entry — enforced in the WHERE clause, not the UI:");
    const ASMA = "00000000-0000-0000-0000-0000000000aa";
    const [mine] = await db
      .select({ id: cashCounts.id })
      .from(cashCounts)
      .where(and(eq(cashCounts.clinicId, clinicId), eq(cashCounts.countedTotal, 4250)));

    // The counts were recorded by BY, not by Asma, so hers is not this row.
    const refused = await updateCashCount(clinicId, mine.id, {
      countedTotal: 1,
      onlyOwnedBy: ASMA,
    });
    check("a colleague's edit is refused", refused, false);
    const [untouched] = await db
      .select({ counted: cashCounts.countedTotal })
      .from(cashCounts)
      .where(and(eq(cashCounts.clinicId, clinicId), eq(cashCounts.id, mine.id)));
    check("…and the figure is untouched", untouched.counted, 4250);

    const allowed = await updateCashCount(clinicId, mine.id, {
      countedTotal: 4250,
      onlyOwnedBy: BY.id,
    });
    check("the person who recorded it may edit it", allowed, true);

    const deleteRefused = await softDeleteCashCount(clinicId, mine.id, { id: ASMA, onlyOwnedBy: ASMA });
    check("and deleting somebody else's is refused too", deleteRefused, false);

    // The predicate the page and the actions share.
    const asAdmin = { id: ASMA, role: "clinic_admin" } as unknown as CurrentUser;
    const asDesk = { id: ASMA, role: "receptionist" } as unknown as CurrentUser;
    check("a clinic admin may modify anybody's", mayModifyEntry(asAdmin, BY.id), true);
    check("the front desk may not", mayModifyEntry(asDesk, BY.id), false);
    check("…but may modify their own", mayModifyEntry(asDesk, ASMA), true);
    check("an entry with no recorded owner is nobody's to edit", mayModifyEntry(asDesk, null), false);

    // The history spans TWO tables, so paging it is the ADR-024 shape: bound each
    // source, merge, cut. The failure that shape exists to prevent is a page that
    // silently drops or repeats rows at the boundary, which no single-table test
    // would catch.
    console.log("\nPaging the history across both tables:");
    const all = await listDrawerHistory(clinicId, { limit: 100 });
    check("every count and move is counted once", all.total, all.rows.length);
    // 2 counts + 2 moves, and NOTHING ELSE. The clinic seeded above also has cash
    // payments, a refund and two cash expenses; the history deliberately does not
    // list them (owner's call, 2026-09-23 — a payment belongs to Payments and an
    // expense to Expenses).
    const byKind = (k: string) => all.rows.filter((r) => r.kind === k).length;
    check("both counts are there", byKind("count"), 2);
    check("both moves are there", byKind("move"), 2);
    check("…and nothing borrowed from another ledger", all.rows.length, 4);

    // A "Paid for something" typed HERE is this page's own record, so it is listed —
    // while the cash expenses seeded above, which stand for ones typed in Expenses,
    // are not. `from_drawer` is the only thing separating them, and getting it
    // backwards would either hide the entry somebody just made or drag the whole
    // expense ledger back onto the page.
    console.log("\nA spend recorded AT the drawer is its own record:");
    const [ownSpend] = await db
      .insert(expenses)
      .values({
        clinicId,
        amount: 250,
        incurredOn: localDate(),
        method: "cash",
        note: "gloves",
        fromDrawer: true,
        createdBy: BY.id,
        createdByName: BY.name,
      })
      .returning({ id: expenses.id });
    const withSpend = await listDrawerHistory(clinicId, { limit: 100 });
    const spendRows = withSpend.rows.filter((r) => r.kind === "spend");
    check("it appears in the history", spendRows.length, 1);
    check("…with its amount", spendRows[0]?.kind === "spend" ? spendRows[0].spend.amount : 0, 250);
    check("…and what it was for", spendRows[0]?.kind === "spend" ? spendRows[0].spend.what : null, "gloves");
    check("…and the total counts it", withSpend.total, all.total + 1);
    // The other cash expenses in this clinic were NOT typed here and stay out.
    check("an expense typed in Expenses is still not listed", withSpend.rows.length, 5);

    console.log("\nThe drawer's edit is narrow, and it is narrow in the WHERE clause:");
    const notMine = await updateDrawerSpend(clinicId, ownSpend.id, {
      amount: 400,
      what: "hijack",
      onlyOwnedBy: "00000000-0000-0000-0000-0000000000ff",
    });
    check("somebody else's spend is refused", notMine, false);
    check("the owner may correct it", await updateDrawerSpend(clinicId, ownSpend.id, { amount: 300, what: "gloves x2", onlyOwnedBy: BY.id }), true);
    // The point of a narrow UPDATE: the fields Expenses owns and this form never shows
    // must survive being edited from here.
    const [after] = await db
      .select({ amount: expenses.amount, note: expenses.note, method: expenses.method, incurredOn: expenses.incurredOn })
      .from(expenses)
      .where(and(eq(expenses.clinicId, clinicId), eq(expenses.id, ownSpend.id)));
    check("the amount changed", after.amount, 300);
    check("…and the method it was paid by did NOT get blanked", after.method, "cash");
    check("…nor the date it was incurred", after.incurredOn, localDate());

    // The same narrowing on delete: an ordinary expense is not this page's to remove.
    const [foreign] = await db
      .select({ id: expenses.id })
      .from(expenses)
      .where(and(eq(expenses.clinicId, clinicId), eq(expenses.fromDrawer, false), eq(expenses.amount, 500)));
    check(
      "an expense typed elsewhere cannot be deleted from here",
      await softDeleteDrawerSpend(clinicId, foreign.id, BY.id),
      false,
    );
    check("…but one typed here can", await softDeleteDrawerSpend(clinicId, ownSpend.id, BY.id, { onlyOwnedBy: BY.id }), true);
    const afterDelete = await listDrawerHistory(clinicId, { limit: 100 });
    check("and it leaves the history", afterDelete.rows.filter((r) => r.kind === "spend").length, 0);
    check("…and the total with it", afterDelete.total, all.total);
    // THE HALF THAT MATTERS MORE. Hiding those rows must not take them out of the
    // FIGURE: the patients' cash is physically in the same box, so a drawer that
    // stopped counting it would show a false shortfall at every handover. The list is
    // presentation; `getDrawerState` reads the ledgers itself.
    const stillCounted = await getDrawerState(clinicId);
    check("the drawer still counts the cash it no longer lists", stillCounted.movement.expenses > 0, true);
    // And it is really IN the figure, not merely in the movement object: strip the
    // ledger terms out and `expected` moves. A drawer that listed nothing borrowed AND
    // counted nothing borrowed would pass the assertion above and still be wrong.
    const withoutBorrowed =
      stillCounted.openingTotal + stillCounted.movement.transfersIn - stillCounted.movement.transfersOut;
    check("…and the borrowed cash really is inside `expected`", stillCounted.expected !== withoutBorrowed, true);
    // `collected` is 0 here, and that is the re-basing working rather than a gap: every
    // cash taking seeded above predates the latest count, so it was absorbed into the
    // counted total that this window opens from (see the module's formula comment).
    check("cash taken before the last count is absorbed, not double-counted", stillCounted.movement.collected, 0);

    const seen: string[] = [];
    for (let offset = 0; offset < all.total; offset += 2) {
      const pageRows = await listDrawerHistory(clinicId, { offset, limit: 2 });
      for (const r of pageRows.rows) seen.push(entryId(r));
    }
    const expectedIds = all.rows.map((r) => (entryId(r)));
    check("paging visits every row", seen.length, expectedIds.length);
    check("…exactly once, in the same order", seen.join(","), expectedIds.join(","));
    check("no row appears twice", new Set(seen).size, seen.length);

    // Newest first, ACROSS the two sources — the whole point of merging them.
    const times = all.rows.map((r) => r.at.getTime());
    check(
      "the merged order is newest first",
      times.every((t, i) => i === 0 || times[i - 1] >= t),
      true,
    );

    const past = await listDrawerHistory(clinicId, { offset: 999, limit: 2 });
    check("a page past the end is empty, not wrapped", past.rows.length, 0);
    check("…while the total still reports the truth", past.total, all.total);
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
