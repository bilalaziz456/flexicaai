/**
 * Writes OBSERVED results from the automated suites into the Status column, and
 * records the evidence on a separate sheet.
 *
 * Only IDs a suite actually produced are touched. Every other Status cell is left
 * EMPTY, because a result nobody observed is worse than a blank — it tells the next
 * reader the case was covered when it was not.
 *
 *   node scripts/qa/run/apply-results.mjs
 */
import ExcelJS from "exceljs";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const book = resolve(root, "docs", "qa", "Clinic_Management_Complete_QA_Test_Cases.xlsx");

/**
 * Two automated suites write results, and both land here:
 *
 *   results.json      — the domain suites (money.ts, receipts.ts), which import the
 *                       app's own bill, invoice and approval functions and assert
 *                       the arithmetic.
 *   e2e-results.json  — scripts/e2e.mjs, over HTTP against a running app; written
 *                       by scripts/qa/run/e2e-report.mjs.
 *
 * A missing file is fine — either suite may be run on its own. A DISAGREEMENT is
 * not: if two suites reach opposite verdicts on one case, the disagreement IS the
 * finding, and letting whichever file was read last silently win would destroy it.
 */
const SOURCES = ["results.json", "e2e-results.json"];
const byId = new Map();
const loaded = [];
for (const file of SOURCES) {
  const at = resolve(here, file);
  if (!existsSync(at)) continue;
  const rows = JSON.parse(readFileSync(at, "utf8"));
  loaded.push(`${file} (${rows.length})`);
  for (const r of rows) {
    const prior = byId.get(r.id);
    if (prior && prior.status !== r.status) {
      throw new Error(
        `${r.id}: an earlier source says ${prior.status} and ${file} says ${r.status}. ` +
          `Two suites disagree about one case — settle which is right rather than overwriting one.`,
      );
    }
    // Same verdict twice: keep one row but carry both notes, because a case proven
    // by two independent suites is stronger evidence than one proven by either.
    byId.set(r.id, prior ? { ...r, note: `${prior.note} | ${r.note}` } : r);
  }
}
if (!loaded.length) {
  throw new Error(`No results to apply. Expected ${SOURCES.join(" or ")} in ${here}.`);
}
const results = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
console.log(`reading ${loaded.join(" + ")} -> ${results.length} distinct cases`);

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

/**
 * How many Status cells are filled ACROSS THE SHEET, not how many this run wrote.
 *
 * The Playwright suite in D:\flexicaai-qa writes its own rows through its own tool,
 * so counting `applied` here produced a note that contradicted the spreadsheet it
 * was printed on — understating the coverage by exactly the rows somebody else had
 * filled. Read the sheet instead of assuming this script is the only writer.
 */
let filled = 0;
for (let r = 2; r <= ws.rowCount; r++) {
  if (String(ws.getRow(r).getCell(8).value ?? "").trim()) filled++;
}

ev.addRow({});
ev.addRow({
  id: "SCOPE",
  status: "",
  note:
    `${filled} of ${total} cases carry an observed automated result as of ` +
    `${new Date().toISOString().slice(0, 10)} — ${applied} of them written by this run ` +
    `(${loaded.join(" + ")}), the rest by the Playwright UI suite. The remaining ` +
    `${total - filled} are left BLANK deliberately: they need a human to judge the outcome, test data ` +
    `this run did not create, or a credential this environment does not have. A result nobody observed ` +
    `would be worse than an empty cell.`,
});
ev.getRow(ev.rowCount).font = { italic: true, size: 10.5 };
ev.getRow(ev.rowCount).alignment = { vertical: "top", wrapText: true };

try {
  await wb.xlsx.writeFile(book);
} catch (e) {
  if (e?.code === "EBUSY" || e?.code === "EPERM") {
    console.error(`\nThe workbook is open in Excel:\n  ${book}\nClose it and run this again.\n`);
    process.exit(1);
  }
  throw e;
}
const passed = results.filter((r) => r.status === "Pass").length;
console.log(`applied ${applied} results (${passed} Pass, ${results.length - passed} Fail)`);
console.log(`${filled} of ${total} rows now carry a result; ${total - filled} left blank for manual execution`);
