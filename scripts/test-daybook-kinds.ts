/**
 * The day book classifies EVERY payment kind (`core/finance/daybook.ts#aggregateCash`).
 *
 * WHY: it used to be an allow-list — `payment`, `advance`, `advance_applied` counted as
 * collected, `refund` as out, and anything else fell through both branches in silence.
 * `opening` (cash taken against an imported opening balance, written by
 * `settleOpeningBalance`) is a real fifth kind, so settling one was money in the drawer
 * that appeared in neither the day book nor the Overview cash summary. The query does
 * not filter by kind, so the rows were there — they were simply dropped while folding.
 *
 * It also covers the third cash source, added later: a DOCTOR PAYOUT is money leaving
 * the drawer, but `recordPayout` writes only to `doctor_payouts` — no expense row — so
 * the day book showed nothing for it at all. Payouts are their own column rather than
 * folded into `expenses`, since nothing writes them to the expenses ledger.
 *
 * This pins the classification against `patient_payments`' actual vocabulary, which is
 * the CHECK constraint added in migration 0084. If a kind is added to that constraint
 * without being classified here, this test fails — which is the point.
 */
import { sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { aggregateCash } from "@/core/finance/daybook";

let pass = 0;
let fail = 0;

function ok(label: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}`);
  }
}

type Pay = { kind: string; method: string | null; amount: number };

const one = (kind: string, amount = 1000, method: string | null = "cash"): Pay[] => [
  { kind, method, amount },
];

async function main() {
  console.log("\nDay book — every payment kind is classified\n");

  // The bug, stated directly: an opening-balance settlement is cash collected.
  const opening = aggregateCash(one("opening"), [], []);
  ok("'opening' counts as collected", opening.totals.collected === 1000);
  ok("'opening' is not counted as a refund", opening.totals.refunded === 0);
  ok("'opening' reaches the totals (net)", opening.totals.net === 1000);
  ok(
    "'opening' lands in its own method bucket, not a stray one",
    opening.rows.length === 1 && opening.rows[0].method === "cash",
  );

  // The kinds that already worked must keep working.
  ok("'payment' collected", aggregateCash(one("payment"), [], []).totals.collected === 1000);
  ok("'advance' collected", aggregateCash(one("advance"), [], []).totals.collected === 1000);
  ok(
    "'advance_applied' collected (see the note in aggregateCash)",
    aggregateCash(one("advance_applied", 1000, "advance"), [], []).totals.collected === 1000,
  );
  ok("'refund' is money out", aggregateCash(one("refund"), [], []).totals.refunded === 1000);
  ok("'refund' does not count as collected", aggregateCash(one("refund"), [], []).totals.collected === 0);

  // A row paid from stored credit carries method='advance', which is not a tender, so
  // it must still group somewhere rather than create a bucket of its own.
  const fromCredit = aggregateCash(one("advance_applied", 500, "advance"), [], []);
  ok(
    "method 'advance' folds into the 'other' bucket for grouping",
    fromCredit.rows.length === 1 && fromCredit.rows[0].method === "other",
  );

  // A doctor payout is cash out of the drawer.
  const payout = aggregateCash([], [], [{ method: "cash", amount: 5000 }]);
  ok("a payout counts as money out", payout.totals.payouts === 5000);
  ok("a payout reduces net", payout.totals.net === -5000);
  ok("a payout is not counted as an expense", payout.totals.expenses === 0);
  ok("a payout is not counted as a refund", payout.totals.refunded === 0);

  // The whole point of the fix: collections and a payout on the same day, same method,
  // must net out. Before this, the payout was absent and net read 20000.
  const mixed = aggregateCash(one("payment", 20000), [], [{ method: "cash", amount: 15000 }]);
  ok("collections and payouts net against each other", mixed.totals.net === 5000);
  ok("both sides stay visible on the row", mixed.rows[0].collected === 20000 && mixed.rows[0].payouts === 15000);

  // A payout paid by bank must not land in the cash bucket — this is a per-method
  // report and reconciliation is done one tender at a time.
  const byMethod = aggregateCash(one("payment", 1000, "cash"), [], [{ method: "bank", amount: 400 }]);
  const cashRow = byMethod.rows.find((r) => r.method === "cash");
  const bankRow = byMethod.rows.find((r) => r.method === "bank");
  ok("payout lands in its own method bucket", bankRow?.payouts === 400 && cashRow?.payouts === 0);
  ok("net is per method, not pooled", cashRow?.net === 1000 && bankRow?.net === -400);

  // Expenses are money out regardless of kind.
  ok(
    "expenses subtract from net",
    aggregateCash(one("payment"), [{ method: "cash", amount: 400 }], []).totals.net === 600,
  );

  // THE GUARD: every value the DB permits must be classified. Read the allowed set off
  // the live CHECK constraint rather than restating it here — a list copied into a test
  // drifts from the constraint exactly like a copied bill formula (ADR-015).
  // THE GUARD: every value the database permits must be classified here. Read the
  // allowed set from the LOOKUP TABLE rather than restating it — a list copied into a
  // test drifts from its source exactly like a copied bill formula (ADR-015). This
  // used to read the CHECK constraint of migration 0084; the foreign key replaced it,
  // so `payment_kinds` is now the authority.
  await unscoped("reads a company-global vocabulary table", async () => {
    const kinds = (
      (await db.execute(sql`select code from payment_kinds order by sort_order`)).rows as {
        code: string;
      }[]
    ).map((r) => r.code);

    ok("the payment_kinds vocabulary is populated", kinds.length >= 5);

    for (const kind of kinds) {
      // An unclassified kind falls through to neither column, so both totals stay 0 —
      // exactly the failure 'opening' had.
      const t = aggregateCash(one(kind, 700), [], []).totals;
      ok(`'${kind}' is classified (collected or refunded, not dropped)`, t.collected + t.refunded === 700);
    }
  });



  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
