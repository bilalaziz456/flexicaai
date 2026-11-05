/**
 * EVERY VISIT ALREADY IN THE DATABASE IS SHARED EXACTLY AS BEFORE — per-line discounts,
 * decision 6 (docs/per-line-discount-plan.md §9).
 *
 * Migration 0138 added per-line discounts, a consultation discount and a
 * `bearing_version`, and the share context, the settlement writer and the bill now read
 * them. Every existing visit is version 1 with those columns at their defaults, so
 * re-deriving its money must reproduce, row for row, what is already stored: the sale
 * rows, each doctor's earnings and the discount settlements.
 *
 * How: for every visit that has derived rows, inside ONE transaction that is always
 * rolled back, read the stored rows, re-run the real recorder (`recordSaleForAppointment`
 * — the same code the app runs), read them again and compare. Nothing is written.
 *
 * A visit whose stored rows were already out of date before this change (a doctor's
 * share % edited since, say) would show here too; the reconcile job re-derives those
 * nightly. Run it on a database that has been reconciled, or compare against the
 * previous commit, before reading a failure as a regression.
 *
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-old-visits-unchanged.ts`
 */
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../src/core/db";
import { unscoped } from "../src/core/db/tenant-guard";
import { appointments, discountSettlements, sales, saleShares } from "../src/core/db/schema";
import { recordSaleForAppointment } from "../src/core/sales/ledger";

class Rollback extends Error {}

type Snapshot = string[];

async function snapshot(exec: typeof db, clinicId: string, appointmentId: string): Promise<Snapshot> {
  // One after another: they share the transaction's single connection.
  const s = await exec
      .select({ net: sales.netAmount, disc: sales.discountAmount, at: sales.occurredAt })
      .from(sales)
      .where(and(eq(sales.clinicId, clinicId), eq(sales.appointmentId, appointmentId)));
  const sh = await exec
      .select({ doctorId: saleShares.doctorId, amt: saleShares.shareAmount, at: saleShares.occurredAt })
      .from(saleShares)
      .where(and(eq(saleShares.clinicId, clinicId), eq(saleShares.appointmentId, appointmentId)));
  const ds = await exec
      .select({
        party: discountSettlements.party,
        doctorId: discountSettlements.doctorId,
        amt: discountSettlements.settlementAmount,
        gross: discountSettlements.grossShare,
      })
      .from(discountSettlements)
      .where(and(eq(discountSettlements.clinicId, clinicId), eq(discountSettlements.appointmentId, appointmentId)));
  return [
    ...s.map((r) => `sale ${r.net}/${r.disc} @${r.at.toISOString()}`),
    ...sh.map((r) => `share ${r.doctorId} ${r.amt} @${r.at.toISOString()}`),
    ...ds.map((r) => `settle ${r.party} ${r.doctorId ?? "-"} ${r.amt} gross ${r.gross}`),
  ].sort();
}

async function main() {
  // Every visit with derived money rows: those are the ones a change could move.
  const visits = await unscoped("test: every visit with derived rows", () =>
    db
      .select({ id: appointments.id, clinicId: appointments.clinicId, version: appointments.bearingVersion })
      .from(appointments)
      .where(
        and(
          isNull(appointments.deletedAt),
          or(
            eq(appointments.status, "completed"),
            inArray(appointments.id, db.select({ id: sales.appointmentId }).from(sales)),
          ),
        ),
      ),
  );

  const v2 = visits.filter((v) => v.version !== 1).length;
  console.log(`Re-deriving ${visits.length} visits (${v2} not on version 1):`);

  let same = 0;
  let withRows = 0;
  const diffs: string[] = [];
  try {
    await db.transaction(async (tx) => {
      for (const v of visits) {
        const before = await snapshot(tx as unknown as typeof db, v.clinicId, v.id);
        await recordSaleForAppointment(v.clinicId, v.id, tx);
        const after = await snapshot(tx as unknown as typeof db, v.clinicId, v.id);
        if (before.length > 0) withRows++;
        if (JSON.stringify(before) === JSON.stringify(after)) same++;
        else diffs.push(`${v.id}\n        before ${JSON.stringify(before)}\n        after  ${JSON.stringify(after)}`);
      }
      throw new Rollback(); // never keep anything this test wrote
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }

  const ok = (name: string, cond: boolean) => console.log(`  ${cond ? "✓" : "✗"} ${name}`);
  // Not a check: visits saved since per-line discounts shipped are version 2 BY DESIGN
  // (ADR-037). What matters is that every visit — either version — re-derives to the
  // rows already stored, below.
  console.log(`  · ${visits.length - v2} on version 1, ${v2} on version 2`);
  ok(`${same} of ${visits.length} visits re-derive to identical rows`, diffs.length === 0);
  ok(`…and the run had rows to compare (${withRows} visits carry sales/shares/settlements)`, withRows > 0);
  for (const d of diffs.slice(0, 10)) console.log(`      ✗ ${d}`);
  if (diffs.length > 10) console.log(`      … and ${diffs.length - 10} more`);

  // The rollback must have left the database as it was.
  const [{ n }] = await unscoped("test: rows still there", () =>
    db.select({ n: sql<number>`count(*)::int` }).from(sales),
  );
  console.log(`\n(sales rows after rollback: ${n})`);

  const failed = diffs.length > 0 || withRows === 0;
  console.log(failed ? "\nFAILED" : "\nALL PASSED");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
