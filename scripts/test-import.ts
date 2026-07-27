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
import { clinics, patients, procedures, users, visits } from "../src/core/db/schema";
import { byClinic, notDeleted } from "../src/core/db/tenant";
import { parseCsv, parseXlsx } from "../src/core/admin/import/parse";
import { previewImport, commitImport, undoBatch, listBatches } from "../src/core/admin/import";
import { getOutstandingTotal, getReceivablesReport } from "../src/core/finance/receivables";
import { getOpeningBalanceOwed, settleOpeningBalance } from "../src/core/billing/payments";
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

    console.log("Settle opening balance:");
    {
      const [ay] = await db
        .select({ id: patients.id })
        .from(patients)
        .where(byClinic(patients.clinicId, cid, notDeleted(patients.deletedAt), eq(patients.openingBalance, 5000)))
        .limit(1);
      const r = await settleOpeningBalance(cid, { patientId: ay.id, amount: 2000, method: "cash", reference: null, note: null, actor });
      check("settle returns ok", "ok" in r && r.ok === true, true);
      check("owed drops 5000 → 3000", await getOpeningBalanceOwed(cid, ay.id), 3000);
      check("receivables total drops 7500 → 5500", (await getReceivablesReport(cid)).total, 5500);
      const over = await settleOpeningBalance(cid, { patientId: ay.id, amount: 99999, method: null, reference: null, note: null, actor });
      check("over-payment rejected", "error" in over, true);
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
    console.log("Clinical notes (visits):");
    {
      // Fresh live patients to match against + a doctor to map by name.
      const [doc] = await db
        .insert(users)
        .values({ clinicId: cid, username: `e2edoc${Date.now()}`, passwordHash: "x", role: "doctor", fullName: "Bilal Aziz" })
        .returning({ id: users.id });
      await commitImport(
        cid,
        "patients",
        "p2.csv",
        toBuf("full_name,phone,external_ref\r\nAyesha Khan,03001234567,P-100\r\nSara Ali,03007654321,P-200\r\n"),
        actor,
      );

      const visitCsv =
        "external_ref,visit_date,doctor,diagnosis,treatment,note\r\n" +
        "P-100,2024-03-15,Dr Bilal Aziz,Caries 26,Composite filling,Review in 2 weeks\r\n" +
        "P-200,2024-01-10,,Gingivitis,Scaling,Better brushing\r\n" +
        "P-999,2024-01-10,,X,Y,Z\r\n" + // patient not found → error
        "P-100,2024-03-15,Dr Bilal Aziz,Caries 26,Composite filling,Review in 2 weeks\r\n"; // dup → skip

      const pre = await previewImport(cid, "visits", "v.csv", toBuf(visitCsv));
      check("visits ready = 2", pre.ready, 2);
      check("visits errored = 1 (patient not found)", pre.errored, 1);
      check("visits dup = 1", pre.duplicates, 1);

      const vr = await commitImport(cid, "visits", "v.csv", toBuf(visitCsv), actor);
      check("visits imported = 2", vr.imported, 2);

      const vrows = await db
        .select({ doctorId: visits.doctorId, status: visits.status, imported: visits.imported, note: visits.note })
        .from(visits)
        .where(byClinic(visits.clinicId, cid, notDeleted(visits.deletedAt)));
      check("2 visits live", vrows.length, 2);
      check("all approved + imported", vrows.every((v) => v.status === "approved" && v.imported === true), true);
      check("doctor mapped by name", vrows.some((v) => v.doctorId === doc.id), true);
      const mapped = vrows.find((v) => v.doctorId === doc.id);
      check("summary combines diagnosis + treatment + note", (mapped?.note as { summary?: string })?.summary?.includes("Diagnosis: Caries 26") && (mapped?.note as { summary?: string })?.summary?.includes("Review in 2 weeks"), true);

      const vbatch = (await listBatches(cid)).find((b) => b.entity === "visits")!;
      await undoBatch(cid, vbatch.id, actor);
      const liveV = await db.select({ id: visits.id }).from(visits).where(byClinic(visits.clinicId, cid, notDeleted(visits.deletedAt)));
      check("visits undone (soft-deleted)", liveV.length, 0);
    }
    console.log("Column mapping (non-standard headers):");
    {
      // Headers our aliases do NOT catch → nothing auto-detects, so 0 ready.
      const csv = "Patient Full Name,Cell No,Old File,Amount Due\r\nMahnoor Test,03119998877,X-1,5000\r\n";
      const noMap = await previewImport(cid, "patients", "nm.csv", toBuf(csv));
      check("without mapping → 0 ready (name column not detected)", noMap.ready, 0);
      check("suggested mapping has no full_name", noMap.mapping.full_name ?? "", "");

      const mapping = { full_name: "patient_full_name", phone: "cell_no", external_ref: "old_file", opening_balance: "amount_due" };
      const withMap = await previewImport(cid, "patients", "nm.csv", toBuf(csv), mapping);
      check("with mapping → 1 ready", withMap.ready, 1);

      const res = await commitImport(cid, "patients", "nm.csv", toBuf(csv), actor, mapping);
      check("committed 1 via mapping", res.imported, 1);
      const [p] = await db
        .select({ name: patients.fullName, phone: patients.phone, ext: patients.externalRef, opening: patients.openingBalance })
        .from(patients)
        .where(byClinic(patients.clinicId, cid, notDeleted(patients.deletedAt), eq(patients.externalRef, "X-1")))
        .limit(1);
      check("mapped fields landed correctly", { name: p?.name, phone: p?.phone, ext: p?.ext, opening: p?.opening }, { name: "Mahnoor Test", phone: "+923119998877", ext: "X-1", opening: 5000 });
    }
  } finally {
    await db.delete(clinics).where(eq(clinics.id, cid)); // cascade cleans patients/procedures/visits/batches
  }

  console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
