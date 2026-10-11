/**
 * A typed invoice / receipt number is matched EXACTLY on the invoice register and the
 * payments ledger (owner's report 2026-10-12: searching "0000002" listed 20+ invoices).
 * Pure parser checks, then the two real list queries against every clinic's own data.
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-doc-number-search.ts`
 */
import { sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { parseDocNumber } from "@/core/billing/doc-number";
import { getInvoicesList } from "@/core/billing/invoice";
import { getPaymentsLedger } from "@/core/finance/payments-ledger";

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
  console.log("Reading a typed number:");
  const eqDoc = (q: string, year: number | null, no: number) => {
    const d = parseDocNumber(q);
    ok(`"${q}" → ${year ?? "any year"} #${no}`, d?.year === year && d?.no === no, JSON.stringify(d));
  };
  eqDoc("0000002", null, 2);
  eqDoc("2", null, 2);
  eqDoc("INV-2026-0000002", 2026, 2);
  eqDoc("2026-2", 2026, 2);
  ok('"03450186120" (a phone) is not a document number', parseDocNumber("03450186120") === null);
  ok('"umer" is not a document number', parseDocNumber("umer") === null);

  await unscoped("behaviour test — reads every clinic's own invoices", async () => {
    const res = await db.execute(sql`select clinic_id::text as clinic_id, invoice_no from invoices where deleted_at is null order by issued_at desc limit 5`);
    const sample = res.rows as { clinic_id: string; invoice_no: number }[];
    if (sample.length === 0) {
      console.log("\n(no invoices in this database — list checks skipped)");
      return;
    }
    console.log("\nInvoice register and payments ledger:");
    for (const s of sample) {
      const padded = String(s.invoice_no).padStart(7, "0");
      const inv = await getInvoicesList(s.clinic_id, { q: padded });
      ok(`invoice register "${padded}" lists only invoice ${s.invoice_no}`, inv.rows.length > 0 && inv.rows.every((r) => r.invoiceNo === s.invoice_no), `${inv.rows.length} rows: ${inv.rows.slice(0, 5).map((r) => r.label).join(", ")}`);
      const pay = await getPaymentsLedger(s.clinic_id, { q: `INV-${padded}` });
      ok(`payments "INV-${padded}" lists only payments against it`, pay.rows.every((r) => r.invoiceLabel?.endsWith(padded) ?? false), `${pay.rows.length} rows`);
    }
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
