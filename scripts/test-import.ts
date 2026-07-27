/**
 * Functional test for the data importer (Phase 1) — against the real DB on a
 * throwaway clinic. Covers CSV + xlsx parsing, validation (required/dedup/errors),
 * MRN allocation, external_ref + opening_balance, the opening balance flowing into
 * receivables, and undo. Run:
 *   tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-import.ts
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { db } from "../src/core/db";
import { clinics, patients, procedures } from "../src/core/db/schema";
import { byClinic, notDeleted } from "../src/core/db/tenant";
import { parseCsv, parseXlsx } from "../src/core/admin/import/parse";
import { previewImport, commitImport, undoBatch, listBatches } from "../src/core/admin/import";
import { getOutstandingTotal, getReceivablesReport } from "../src/core/finance/receivables";
import { formatMrn } from "../src/core/patients/mrn";

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
const toBuf = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer;
const actor = { id: randomUUID(), name: "Importer Test" };

async function main() {
  const [clinic] = await db.insert(clinics).values({ name: `IMPORT TEST ${Date.now()}` }).returning({ id: clinics.id });
  const cid = clinic.id;
  try {
    console.log("CSV parse:");
    {
      const { rows, headers } = parseCsv(`Full Name,Phone\r\n"Khan, Sara",03001112222\r\nAli,0300`);
      check("normalises headers", headers, ["full_name", "phone"]);
      check("keeps a quoted comma", rows[0].full_name, "Khan, Sara");
      check("row count", rows.length, 2);
    }

    console.log("Patients — preview:");
    const patientsCsv =
      "full_name,phone,age,external_ref,opening_balance\r\n" +
      "Ayesha Khan,03001234567,32,OLD-1,5000\r\n" +
      "Bilal Ahmed,0300-111-2222,,OLD-2,0\r\n" +
      '"Khan, Sara",03007654321,45,OLD-3,2500\r\n' +
      ",03009999999,20,OLD-4,0\r\n" + // missing name → error
      "Dup Ayesha,03001234567,10,OLD-5,0\r\n"; // duplicate phone → skip
    {
      const p = await previewImport(cid, "patients", "p.csv", toBuf(patientsCsv));
      check("ready = 3", p.ready, 3);
      check("errored = 1 (missing name)", p.errored, 1);
      check("duplicates = 1 (same phone)", p.duplicates, 1);
    }

    console.log("Patients — commit:");
    const res = await commitImport(cid, "patients", "p.csv", toBuf(patientsCsv), actor);
    check("imported = 3", res.imported, 3);
    {
      const rows = await db
        .select({ mrn: patients.mrn, createdAt: patients.createdAt, name: patients.fullName, phone: patients.phone, ext: patients.externalRef, opening: patients.openingBalance })
        .from(patients)
        .where(byClinic(patients.clinicId, cid, notDeleted(patients.deletedAt)))
        .orderBy(patients.mrn);
      check("3 patients live", rows.length, 3);
      check("MRNs allocated 1..3", rows.map((r) => r.mrn), [1, 2, 3]);
      check("MRN formats as KL-<date>0000001", formatMrn("KL-", rows[0].mrn, rows[0].createdAt)?.startsWith("KL-") && formatMrn("KL-", rows[0].mrn, rows[0].createdAt)?.endsWith("0000001"), true);
      check("phone normalised to E.164", rows.find((r) => r.ext === "OLD-2")?.phone, "+923001112222");
      check("external_ref stored", rows.map((r) => r.ext).sort(), ["OLD-1", "OLD-2", "OLD-3"]);
      check("opening balances stored", rows.reduce((s, r) => s + r.opening, 0), 7500);
    }

    console.log("Opening balance → receivables:");
    check("getOutstandingTotal = 7500", await getOutstandingTotal(cid), 7500);
    {
      const rep = await getReceivablesReport(cid);
      check("receivables total = 7500", rep.total, 7500);
      check("2 patients owe (opening only)", rep.patientCount, 2);
      check("each carries an openingBalance", rep.patients.every((p) => p.openingBalance > 0), true);
    }

    console.log("Undo:");
    {
      const [batch] = await listBatches(cid);
      const ok = await undoBatch(cid, batch.id, actor);
      check("undo returns true", ok, true);
      const live = await db.select({ id: patients.id }).from(patients).where(byClinic(patients.clinicId, cid, notDeleted(patients.deletedAt)));
      check("all imported patients soft-deleted", live.length, 0);
      check("receivables back to 0", await getOutstandingTotal(cid), 0);
      check("batch marked undone", (await listBatches(cid))[0].status, "undone");
    }

    console.log("Procedures via xlsx:");
    {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Sheet1");
      ws.addRow(["name", "price", "is_active"]);
      ws.addRow(["Scaling", "3000", "yes"]);
      ws.addRow(["Filling", "2500", ""]);
      ws.addRow(["Scaling", "9999", ""]); // dup name → skip
      ws.addRow(["", "100", ""]); // missing name → error
      const xbuf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
      const parsed = await parseXlsx(xbuf);
      check("xlsx parsed 4 data rows", parsed.rows.length, 4);
      const pre = await previewImport(cid, "procedures", "p.xlsx", xbuf);
      check("procedures ready = 2", pre.ready, 2);
      check("procedures dup = 1", pre.duplicates, 1);
      check("procedures error = 1", pre.errored, 1);
      const r = await commitImport(cid, "procedures", "p.xlsx", xbuf, actor);
      check("procedures imported = 2", r.imported, 2);
      const live = await db.select({ name: procedures.name, price: procedures.price }).from(procedures).where(byClinic(procedures.clinicId, cid, notDeleted(procedures.deletedAt)));
      check("2 live procedures", live.length, 2);
      check("prices parsed", live.map((p) => p.price).sort((a, b) => a - b), [2500, 3000]);
    }
  } finally {
    await db.delete(clinics).where(eq(clinics.id, cid)); // cascade cleans patients/procedures/batches
  }

  console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
