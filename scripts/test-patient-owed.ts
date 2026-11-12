/**
 * The patient list's "Owes money" filter and its per-patient amounts must agree with
 * Receivables — the same patients, the same rupees — and its header total with the
 * dashboard's Outstanding. Both read the same rule (`owedVisitSql` + the net opening
 * balance), but the patient list builds it as joined pre-aggregates while Receivables
 * groups visits and folds opening balances in TypeScript, so only a comparison proves
 * they agree. Run against EVERY clinic in the database, real data included.
 *
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-patient-owed.ts`
 */
import { isNull } from "drizzle-orm";
import { db } from "../src/core/db";
import { clinics } from "../src/core/db/schema";
import { unscoped } from "../src/core/db/tenant-guard";
import { listClinicPatients, listPatientsForExport } from "../src/core/patients/list";
import { getOutstandingTotal, getReceivablesReport } from "../src/core/finance/receivables";

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else {
    failed++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const all = await unscoped("test: every clinic", () =>
    db.select({ id: clinics.id }).from(clinics).where(isNull(clinics.deletedAt)),
  );
  let owingSeen = 0;
  for (const { id } of all) {
    const BIG = { offset: 0, limit: 100_000 };
    const [list, report, outstanding, exported] = await Promise.all([
      listClinicPatients(id, "", BIG, { owesOnly: true }),
      getReceivablesReport(id, {}, BIG),
      getOutstandingTotal(id),
      listPatientsForExport(id, "", { owesOnly: true }),
    ]);
    const fromList = new Map(list.rows.map((r) => [r.id, r.owed ?? 0]));
    const fromReport = new Map(report.patients.map((p) => [p.patientId, p.outstanding]));
    owingSeen += fromReport.size;

    check(`${id}: same number of patients`, fromList.size === fromReport.size, `${fromList.size} vs ${fromReport.size}`);
    for (const [pid, amt] of fromReport) {
      check(`${id}/${pid}: same amount`, fromList.get(pid) === amt, `${fromList.get(pid)} vs ${amt}`);
    }
    check(`${id}: header count`, list.owing?.count === fromReport.size);
    check(`${id}: header total = Receivables`, list.owing?.amount === report.total, `${list.owing?.amount} vs ${report.total}`);
    check(`${id}: header total = dashboard Outstanding`, list.owing?.amount === outstanding, `${list.owing?.amount} vs ${outstanding}`);
    check(`${id}: CSV = list`, exported.length === list.rows.length);

    // Most owed first.
    const amounts = list.rows.map((r) => r.owed ?? 0);
    check(`${id}: sorted by amount`, amounts.every((a, i) => i === 0 || amounts[i - 1] >= a));

    // The unfiltered list marks the same patients, and nobody else.
    const plain = await listClinicPatients(id, "", BIG, { withOwed: true });
    const marked = plain.rows.filter((r) => (r.owed ?? 0) > 0);
    check(`${id}: highlighted = owing`, marked.length === fromReport.size && marked.every((r) => fromReport.get(r.id) === r.owed));
  }
  check("data: at least one patient owes somewhere", owingSeen > 0, "nothing exercised the comparison");
  console.log(`${passed} passed, ${failed} failed (${all.length} clinics, ${owingSeen} owing patients)`);

  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);

  process.exit(1);
});
