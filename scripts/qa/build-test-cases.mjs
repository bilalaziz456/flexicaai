/**
 * Builds the manual-QA workbook from `test-cases.json`.
 *
 * The test cases live in JSON, not in the .xlsx, so they can be reviewed in a diff
 * and regenerated when the app changes — a binary spreadsheet that only exists as a
 * download goes stale silently and nobody can see what moved.
 *
 *   node scripts/qa/build-test-cases.mjs
 *
 * The Status column is written EMPTY on purpose. QA fills it in; anything we put
 * there would be a result we did not observe.
 */
import ExcelJS from "exceljs";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const read = (p) => JSON.parse(readFileSync(resolve(here, p), "utf8"));

// Cases are split per module so each file stays reviewable; they are merged in
// filename order, which is also the order they appear in the sheet.
const caseDir = resolve(here, "cases");
const cases = readdirSync(caseDir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .flatMap((f) => JSON.parse(readFileSync(resolve(caseDir, f), "utf8")));

const data = {
  cases,
  readme: read("readme-content.json").readme,
  roleCoverage: read("role-coverage.json"),
  featureCoverage: read("feature-coverage.json"),
};
const outPath = resolve(root, "docs", "qa", "Clinic_Management_Complete_QA_Test_Cases.xlsx");

const INK = "FF15242B";
const HEAD_BG = "FF0B7F86";
const ZEBRA = "FFF2F7F8";
const BLOCKED_BG = "FFFCF1DD";

const wb = new ExcelJS.Workbook();
wb.creator = "FlexicaAI QA";
wb.created = new Date();

/* ── duplicate-ID guard ──────────────────────────────────────────────────────
   A repeated Test Case ID makes a results sheet impossible to reconcile, and it
   is the one error that is invisible once the file is in a tester's hands. */
const seen = new Set();
for (const c of data.cases) {
  if (seen.has(c.id)) throw new Error(`Duplicate Test Case ID: ${c.id}`);
  seen.add(c.id);
  for (const f of ["role", "module", "name", "pre", "steps", "expected"]) {
    if (!c[f] || !String(c[f]).trim()) throw new Error(`${c.id}: empty "${f}"`);
  }
}

/* ── Sheet 1: All Test Cases ─────────────────────────────────────────────── */
const ws = wb.addWorksheet("All Test Cases", {
  views: [{ state: "frozen", ySplit: 1 }],
  properties: { defaultRowHeight: 15 },
});

ws.columns = [
  { header: "Test Case ID", key: "id", width: 18 },
  { header: "Role", key: "role", width: 15 },
  { header: "Module", key: "module", width: 22 },
  { header: "Test Name", key: "name", width: 46 },
  { header: "Preconditions", key: "pre", width: 42 },
  { header: "Steps", key: "steps", width: 76 },
  { header: "Expected Result", key: "expected", width: 60 },
  { header: "Status", key: "status", width: 12 },
];

for (const c of data.cases) {
  ws.addRow({
    id: c.id,
    role: c.role,
    module: c.module,
    name: c.name,
    pre: c.pre,
    steps: c.steps,
    expected: c.expected,
    status: "", // left blank — QA fills this in
  });
}

const head = ws.getRow(1);
head.height = 26;
head.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };
head.alignment = { vertical: "middle", horizontal: "left" };

ws.autoFilter = { from: "A1", to: `H${data.cases.length + 1}` };

ws.eachRow((row, n) => {
  if (n === 1) return;
  row.alignment = { vertical: "top", wrapText: true };
  row.font = { size: 10.5, color: { argb: INK } };
  // The blocked rows are tinted so a tester sees at a glance that a failure there
  // is expected and not worth raising.
  const blocked = String(row.getCell("pre").value || "").startsWith("[BLOCKED");
  if (blocked) {
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLOCKED_BG } };
  } else if (n % 2 === 0) {
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
  }
  row.getCell("id").font = { size: 10.5, bold: true, color: { argb: INK }, name: "Consolas" };
  row.getCell("status").border = {
    left: { style: "thin", color: { argb: "FFBFD2D5" } },
  };
});

/* ── Sheet 2: Test Summary ───────────────────────────────────────────────── */
const sum = wb.addWorksheet("Test Summary", { views: [{ state: "frozen", ySplit: 1 }] });
sum.columns = [
  { header: "Grouping", key: "g", width: 22 },
  { header: "Value", key: "v", width: 40 },
  { header: "Test cases", key: "n", width: 14 },
];

const tally = (fn) => {
  const m = new Map();
  for (const c of data.cases) {
    const k = fn(c);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

// The Module column is deliberately granular ("AI Scribe — Recording") so a tester can
// filter to one slice of a feature. For the summary that is too fine to read, so the
// headline tally groups on the part before the dash.
const topLevel = (c) => String(c.module).split(" — ")[0];

const blocked = data.cases.filter((c) => String(c.pre).startsWith("[BLOCKED")).length;

sum.addRow({ g: "TOTAL", v: "All test cases", n: data.cases.length });
sum.addRow({ g: "TOTAL", v: "Executable now", n: data.cases.length - blocked });
sum.addRow({ g: "TOTAL", v: "Blocked (needs OPENAI_API_KEY)", n: blocked });
sum.addRow({});
for (const [role, n] of tally((c) => c.role)) sum.addRow({ g: "By role", v: role, n });
sum.addRow({});
for (const [mod, n] of tally(topLevel)) sum.addRow({ g: "By module", v: mod, n });
sum.addRow({});
for (const [mod, n] of tally((c) => c.module)) sum.addRow({ g: "By sub-module", v: mod, n });

const sHead = sum.getRow(1);
sHead.font = { bold: true, color: { argb: "FFFFFFFF" } };
sHead.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };
sum.eachRow((row, n) => {
  if (n === 1) return;
  row.alignment = { vertical: "top", wrapText: true };
  if (String(row.getCell("g").value) === "TOTAL") row.font = { bold: true };
});

/* ── Sheet 3: Role Coverage ──────────────────────────────────────────────── */
const rc = wb.addWorksheet("Role Coverage", { views: [{ state: "frozen", ySplit: 1 }] });
rc.columns = [
  { header: "Role", key: "role", width: 16 },
  { header: "Module", key: "module", width: 24 },
  { header: "Allowed / Restricted", key: "access", width: 22 },
  { header: "What the tester must confirm", key: "note", width: 86 },
];
for (const r of data.roleCoverage) rc.addRow(r);
const rHead = rc.getRow(1);
rHead.font = { bold: true, color: { argb: "FFFFFFFF" } };
rHead.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };
rc.eachRow((row, n) => {
  if (n === 1) return;
  row.alignment = { vertical: "top", wrapText: true };
  row.font = { size: 10.5 };
});

/* ── Sheet 4: Feature Coverage ───────────────────────────────────────────── */
const fc = wb.addWorksheet("Feature Coverage", { views: [{ state: "frozen", ySplit: 1 }] });
fc.columns = [
  { header: "Module", key: "module", width: 24 },
  { header: "Feature", key: "feature", width: 34 },
  { header: "Implemented?", key: "state", width: 18 },
  { header: "Test case IDs", key: "ids", width: 34 },
  { header: "Notes for QA", key: "notes", width: 76 },
];
for (const f of data.featureCoverage) fc.addRow(f);
const fHead = fc.getRow(1);
fHead.font = { bold: true, color: { argb: "FFFFFFFF" } };
fHead.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };
fc.eachRow((row, n) => {
  if (n === 1) return;
  row.alignment = { vertical: "top", wrapText: true };
  row.font = { size: 10.5 };
  const s = String(row.getCell("state").value || "");
  if (s.startsWith("NOT")) {
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLOCKED_BG } };
  }
});

/* ── Sheet 5: Read Me First ──────────────────────────────────────────────── */
const rm = wb.addWorksheet("Read Me First");
rm.columns = [{ header: "", key: "a", width: 120 }];
for (const line of data.readme) {
  const row = rm.addRow({ a: line.text });
  row.alignment = { vertical: "top", wrapText: true };
  if (line.h) row.font = { bold: true, size: 12, color: { argb: HEAD_BG } };
  else row.font = { size: 10.5 };
}

mkdirSync(dirname(outPath), { recursive: true });
await wb.xlsx.writeFile(outPath);
console.log(`wrote ${outPath}`);
console.log(`  ${data.cases.length} test cases`);
console.log(`  ${new Set(data.cases.map((c) => c.module)).size} modules, ${new Set(data.cases.map((c) => c.role)).size} roles`);
