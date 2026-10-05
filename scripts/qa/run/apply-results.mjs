/**
 * Writes OBSERVED results from results.json into the Status column, and records the
 * evidence on a separate sheet.
 *
 * Only IDs present in results.json are touched. Every other Status cell is left
 * EMPTY, because a result nobody observed is worse than a blank — it tells the next
 * reader the case was covered when it was not.
 *
 *   node scripts/qa/run/apply-results.mjs
 */
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const book = resolve(root, "docs", "qa", "Clinic_Management_Complete_QA_Test_Cases.xlsx");
const results = JSON.parse(readFileSync(resolve(here, "results.json"), "utf8"));
const byId = new Map(results.map((r) => [r.id, r]));

const PASS_BG = "FFE4F3E8";
const FAIL_BG = "FFFBE4E4";

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(book);
const ws = wb.getWorksheet("All Test Cases");

let applied = 0;
const missing = new Set(byId.keys());
for (let r = 2; r <= ws.rowCount; r++) {
  const row = ws.getRow(r);
  const id = String(row.getCell(1).value ?? "");
  const res = byId.get(id);
  if (!res) continue;
  missing.delete(id);
  const cell = row.getCell(8);
  cell.value = res.status;
  cell.font = { bold: true, size: 10.5, color: { argb: res.status === "Pass" ? "FF1B6B38" : "FF9C2626" } };
  cell.alignment = { vertical: "top", horizontal: "center" };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: res.status === "Pass" ? PASS_BG : FAIL_BG },
  };
  applied++;
}
if (missing.size) throw new Error(`results.json has IDs not in the workbook: ${[...missing].join(", ")}`);

/* Evidence sheet — what was actually observed, so a Pass can be checked rather than
   taken on trust. Replaced on each run. */
const existing = wb.getWorksheet("Automated Run");
if (existing) wb.removeWorksheet(existing.id);
const ev = wb.addWorksheet("Automated Run", { views: [{ state: "frozen", ySplit: 1 }] });
ev.columns = [
  { header: "Test Case ID", key: "id", width: 18 },
  { header: "Result", key: "status", width: 10 },
  { header: "What was observed", key: "note", width: 120 },
];
for (const r of results) ev.addRow(r);
const h = ev.getRow(1);
h.font = { bold: true, color: { argb: "FFFFFFFF" } };
h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B7F86" } };
ev.eachRow((row, n) => {
  if (n === 1) return;
  row.alignment = { vertical: "top", wrapText: true };
  row.font = { size: 10.5 };
  const s = String(row.getCell("status").value);
  row.getCell("status").font = { bold: true, color: { argb: s === "Pass" ? "FF1B6B38" : "FF9C2626" } };
});

const total = ws.rowCount - 1;
ev.addRow({});
ev.addRow({
  id: "SCOPE",
  status: "",
  note:
    `${applied} of ${total} cases were executed automatically against the running application on ` +
    `${new Date().toISOString().slice(0, 10)} and carry an observed result. The remaining ` +
    `${total - applied} are left BLANK deliberately: they need a human to judge the outcome, test data ` +
    `this run did not create, or a credential this environment does not have. A result nobody observed ` +
    `would be worse than an empty cell.`,
});
ev.getRow(ev.rowCount).font = { italic: true, size: 10.5 };
ev.getRow(ev.rowCount).alignment = { vertical: "top", wrapText: true };

await wb.xlsx.writeFile(book);
const passed = results.filter((r) => r.status === "Pass").length;
console.log(`applied ${applied} results (${passed} Pass, ${results.length - passed} Fail)`);
console.log(`${total - applied} of ${total} rows left blank for manual execution`);
