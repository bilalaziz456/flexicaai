/**
 * Parity test: the STREAMING exports (keyset-paginated generators) must return the
 * exact same rows as the buffered reads. Runs against the real DB with a tiny batch
 * size (2) to force many keyset pages, then compares row count, amount sum, ordering,
 * and (payments) id-uniqueness with the buffered functions for every clinic.
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-streaming-export.ts`
 */
import { db } from "../src/core/db";
import { clinics } from "../src/core/db/schema";
import { iterateSalesRows, getSalesReport, resolveSalesRange } from "../src/core/sales/report";
import { iteratePaymentsLedger, getPaymentsLedger } from "../src/core/finance/payments-ledger";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`);
  }
}

async function main() {
  // A range wide enough to cover every row, whatever its date.
  const range = resolveSalesRange("custom", "2000-01-01", "2100-01-01");
  const rows = await db.select({ id: clinics.id, name: clinics.name }).from(clinics);

  for (const c of rows) {
    console.log(`\nClinic: ${c.name}`);

    // ---- Sales: streamed vs buffered ----
    const report = await getSalesReport(c.id, range);
    let sCount = 0;
    let sSum = 0;
    let prev = -Infinity;
    let ordered = true;
    for await (const r of iterateSalesRows(c.id, range, undefined, 2)) {
      sCount++;
      sSum += r.net;
      const t = r.occurredAt.getTime();
      if (t < prev) ordered = false;
      prev = t;
    }
    check(`sales count matches buffered (${report.count})`, sCount, report.count);
    check(`sales net-sum matches buffered (${report.netTotal})`, sSum, report.netTotal);
    check("sales streamed in ascending occurred_at", ordered, true);

    // ---- Payments: streamed vs buffered ----
    const ledger = await getPaymentsLedger(c.id, {
      from: range.start,
      toExclusive: range.end,
      limit: 10_000_000,
    });
    const bufSum = ledger.rows.reduce((s, r) => s + r.amount, 0);
    let pCount = 0;
    let pSum = 0;
    let pPrev = Infinity;
    let pOrdered = true;
    const ids = new Set<string>();
    for await (const r of iteratePaymentsLedger(c.id, { from: range.start, toExclusive: range.end }, 2)) {
      pCount++;
      pSum += r.amount;
      ids.add(r.id);
      const t = r.occurredAt.getTime();
      if (t > pPrev) pOrdered = false;
      pPrev = t;
    }
    check(`payments count matches buffered (${ledger.total})`, pCount, ledger.total);
    check(`payments amount-sum matches buffered (${bufSum})`, pSum, bufSum);
    check("payments streamed in descending occurred_at", pOrdered, true);
    check("payments have no duplicate rows across pages", ids.size, pCount);
  }

  console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
